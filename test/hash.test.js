import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createHasher, hashBytes, hashBytesSync, toHex, normalizeDigest } from '../site/lib/hash.js';

const algs = { md5: 'md5', 'sha-256': 'sha256', 'sha-384': 'sha384', 'sha-512': 'sha512' };
const enc = (s) => new TextEncoder().encode(s);

test('known vectors', () => {
  assert.equal(toHex(hashBytesSync('md5', enc(''))), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(toHex(hashBytesSync('md5', enc('The quick brown fox jumps over the lazy dog'))), '9e107d9d372bb6826bd81d3542a419d6');
  assert.equal(toHex(hashBytesSync('sha-256', enc('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(toHex(hashBytesSync('sha-384', enc('abc'))), 'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7');
  assert.equal(toHex(hashBytesSync('sha-512', enc('abc'))), 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f');
});

test('pure-JS implementations match node:crypto across block boundaries', () => {
  for (const [alg, nodeAlg] of Object.entries(algs)) {
    for (const len of [0, 1, 55, 56, 63, 64, 65, 111, 112, 119, 127, 128, 129, 255, 1000]) {
      const data = randomBytes(len);
      assert.equal(toHex(hashBytesSync(alg, data)), createHash(nodeAlg).update(data).digest('hex'), `${alg} len=${len}`);
    }
  }
});

test('incremental updates equal one-shot', () => {
  const data = randomBytes(300_000);
  for (const [alg, nodeAlg] of Object.entries(algs)) {
    const h = createHasher(alg);
    for (let i = 0; i < data.length;) {
      const step = 1 + Math.floor(Math.random() * 9000);
      h.update(data.subarray(i, i + step));
      i += step;
    }
    assert.equal(toHex(h.digest()), createHash(nodeAlg).update(data).digest('hex'), alg);
  }
});

test('async path (WebCrypto when available) agrees', async () => {
  const data = randomBytes(5000);
  for (const [alg, nodeAlg] of Object.entries(algs)) {
    assert.equal(toHex(await hashBytes(alg, data)), createHash(nodeAlg).update(data).digest('hex'));
  }
});

test('normalizeDigest accepts hex variants and base64', () => {
  assert.equal(normalizeDigest('AB:CD ef'), 'abcdef');
  assert.equal(normalizeDigest('q80='), 'abcd');
  assert.equal(normalizeDigest(''), null);
  assert.equal(normalizeDigest('not a hash!'), null);
});
