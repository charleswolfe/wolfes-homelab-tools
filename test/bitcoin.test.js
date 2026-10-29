import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import {
  ripemd160, hash160, base58Check, base58CheckDecode, segwitAddress, decodeSegwitAddress, taprootOutputKey,
  generatePrivateKey, toWif, fromWif, deriveAddresses, descriptorChecksum, descriptorFor, toHex, fromHex,
} from '../site/lib/bitcoin.js';

const KEY_ONE = fromHex('0000000000000000000000000000000000000000000000000000000000000001');

test('RIPEMD-160: reference vectors and node:crypto agreement', () => {
  const enc = (s) => new TextEncoder().encode(s);
  assert.equal(toHex(ripemd160(enc(''))), '9c1185a5c5e9fc54612808977ee8f548b2258d31');
  assert.equal(toHex(ripemd160(enc('abc'))), '8eb208f7e05d987a9b044a8e98c6b087f15a0bfc');
  assert.equal(toHex(ripemd160(enc('message digest'))), '5d0689ef49d2fae572b881b123a85ffa21595f36');
  for (const len of [0, 1, 55, 56, 63, 64, 65, 119, 120, 200]) {
    const b = randomBytes(len);
    assert.equal(toHex(ripemd160(b)), createHash('ripemd160').update(b).digest('hex'), `len ${len}`);
  }
});

test('private key 1: WIF and all address types (well-known values)', () => {
  assert.equal(toWif(KEY_ONE), 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn');
  assert.equal(toWif(KEY_ONE, 'mainnet', false), '5HpHagT65TZzG1PH3CSu63k8DbpvD8s5ip4nEB3kEsreAnchuDf');
  assert.equal(toWif(KEY_ONE, 'testnet'), 'cMahea7zqjxrtgAbB7LSGbcQUr1uX1ojuat9jZodMN87JcbXMTcA');
  const a = deriveAddresses(KEY_ONE);
  assert.equal(a.pubkey, '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
  assert.equal(a.p2pkh, '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH');
  assert.equal(a.p2wpkh, 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'); // BIP 173 example
  assert.equal(a['p2sh-p2wpkh'], '3JvL6Ymt8MVWiCNHC7oWU6nLeHNJKLZGLN');
  assert.equal(deriveAddresses(KEY_ONE, 'mainnet', false).p2pkh, '1EHNa6Q4Jz2uvNExL497mE43ikXhwF6kZm');
  assert.equal(deriveAddresses(KEY_ONE, 'testnet').p2wpkh, 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'); // BIP 173
});

test('Bech32m: BIP 350 vector and decode round trip', () => {
  const gx = fromHex('79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
  assert.equal(segwitAddress('bc', 1, gx), 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0');
  const d = decodeSegwitAddress('BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4');
  assert.equal(d.version, 0);
  assert.equal(toHex(d.program), '751e76e8199196d454941c45d1b3a323f1433bd6');
  assert.throws(() => decodeSegwitAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5'), /Checksum/);
  // A v1 program encoded with the old Bech32 constant must be rejected (BIP 350).
  assert.throws(() => decodeSegwitAddress('bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd'), /Checksum/);
});

test('Taproot: BIP 86 test vector (m/86\'/0\'/0\'/0/0)', () => {
  const internal = fromHex('cc8a4bc64d897bddc5fbc2f670f7a8ba0b386779106cf1223c6fc5d7cd6fc115');
  const output = taprootOutputKey(internal);
  assert.equal(toHex(output), 'a60869f0dbcf1dc659c9cecbaf8050135ea9e8cdc487053f1dc6880949dc684c');
  assert.equal(segwitAddress('bc', 1, output), 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr');
});

test('WIF parsing and validation', () => {
  const k = fromWif('  KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn ');
  assert.deepEqual([k.network, k.compressed, toHex(k.priv)], ['mainnet', true, toHex(KEY_ONE)]);
  assert.equal(fromWif('5HpHagT65TZzG1PH3CSu63k8DbpvD8s5ip4nEB3kEsreAnchuDf').compressed, false);
  assert.equal(fromWif('cMahea7zqjxrtgAbB7LSGbcQUr1uX1ojuat9jZodMN87JcbXMTcA').network, 'testnet');
  assert.throws(() => fromWif('KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWo'), /Checksum mismatch/);
  assert.throws(() => fromWif('KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoW0'), /not a Base58 character/);
  assert.throws(() => fromWif(base58Check(Uint8Array.from([0x80, ...new Uint8Array(32), 1]))), /out of range/);
  assert.throws(() => fromWif(base58Check(Uint8Array.from([0x42, ...KEY_ONE, 1]))), /Unknown network/);
  assert.throws(() => fromWif(''), /Enter a private key/);
});

test('generated keys: valid, unique, round-trip, consistent addresses', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const priv = generatePrivateKey(i % 2 ? 'dice 3 6 1 4 2 5' : '');
    const hex = toHex(priv);
    assert.equal(priv.length, 32);
    assert.ok(!seen.has(hex));
    seen.add(hex);
    const wif = toWif(priv);
    assert.equal(toHex(fromWif(wif).priv), hex);
    const a = deriveAddresses(priv);
    assert.match(a.p2wpkh, /^bc1q[02-9ac-hj-np-z]{38}$/);
    assert.match(a.p2tr, /^bc1p[02-9ac-hj-np-z]{58}$/);
    assert.match(a.p2pkh, /^1[1-9A-HJ-NP-Za-km-z]{25,34}$/);
    assert.match(a['p2sh-p2wpkh'], /^3[1-9A-HJ-NP-Za-km-z]{25,34}$/);
    assert.equal(toHex(decodeSegwitAddress(a.p2wpkh).program), toHex(hash160(fromHex(a.pubkey))));
    assert.equal(toHex(base58CheckDecode(a.p2pkh).slice(1)), toHex(hash160(fromHex(a.pubkey))));
  }
});

test('descriptor checksums: BIP 380 and Bitcoin Core examples', () => {
  assert.equal(descriptorChecksum('raw(deadbeef)'), '89f8spxm');
  assert.equal(descriptorChecksum('addr(mkmZxiEcEd8ZqjQWVZuC6so5dFMKEFpN2j)'), '02wpgw69');
  assert.match(descriptorFor('p2tr', 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn'), /^tr\(KwDi.+\)#[02-9ac-hj-np-z]{8}$/);
  assert.match(descriptorFor('p2sh-p2wpkh', 'K'), /^sh\(wpkh\(K\)\)#/);
});
