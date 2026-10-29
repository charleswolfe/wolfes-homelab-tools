// Bitcoin key and address derivation for the paper wallet.
//
// Elliptic-curve math comes from the vendored, audited @noble/secp256k1.
// The encodings around it (RIPEMD-160, Base58Check, Bech32/Bech32m, WIF,
// BIP 86 Taproot tweak, BIP 380 descriptor checksums) are implemented here
// and tested against the vectors published in the respective BIPs.
import { getPublicKey, Point, utils } from '../vendor/noble-secp256k1/index.js';
import { hashBytesSync } from './hash.js';

export const NETWORKS = {
  mainnet: { name: 'Mainnet', wif: 0x80, p2pkh: 0x00, p2sh: 0x05, hrp: 'bc' },
  testnet: { name: 'Testnet', wif: 0xef, p2pkh: 0x6f, p2sh: 0xc4, hrp: 'tb' },
};

export const ADDRESS_TYPES = [
  { id: 'p2wpkh', name: 'Native SegWit', prefix: { mainnet: 'bc1q', testnet: 'tb1q' }, descriptor: (k) => `wpkh(${k})`, electrum: 'p2wpkh' },
  { id: 'p2tr', name: 'Taproot', prefix: { mainnet: 'bc1p', testnet: 'tb1p' }, descriptor: (k) => `tr(${k})`, electrum: null },
  { id: 'p2sh-p2wpkh', name: 'Nested SegWit', prefix: { mainnet: '3', testnet: '2' }, descriptor: (k) => `sh(wpkh(${k}))`, electrum: 'p2wpkh-p2sh' },
  { id: 'p2pkh', name: 'Legacy', prefix: { mainnet: '1', testnet: 'm/n' }, descriptor: (k) => `pkh(${k})`, electrum: 'p2pkh' },
];

// ---------- hashes ----------

const sha256 = (b) => hashBytesSync('sha-256', b);
const concat = (...arrs) => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};
export const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const fromHex = (h) => Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16));

// RIPEMD-160 (one-shot; inputs here are tiny).
const RL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8, 3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12, 1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2, 4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13];
const RR = [5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12, 6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2, 15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13, 8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14, 12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11];
const SL = [11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8, 7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12, 11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5, 11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12, 9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6];
const SR = [8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6, 9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11, 9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5, 15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8, 8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11];
const KL = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e];
const KR = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000];
const rotl = (x, n) => (x << n) | (x >>> (32 - n));
const rf = (j, x, y, z) => (j < 16 ? x ^ y ^ z : j < 32 ? (x & y) | (~x & z) : j < 48 ? (x | ~y) ^ z : j < 64 ? (x & z) | (y & ~z) : x ^ (y | ~z));

export function ripemd160(msg) {
  const len = msg.length;
  const padded = new Uint8Array(((len + 8) >> 6) * 64 + 64);
  padded.set(msg);
  padded[len] = 0x80;
  const v = new DataView(padded.buffer);
  v.setUint32(padded.length - 8, (len * 8) >>> 0, true);
  v.setUint32(padded.length - 4, Math.floor(len / 0x20000000), true);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const X = new Array(16);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) X[i] = v.getUint32(off + i * 4, true);
    let al = h0, bl = h1, cl = h2, dl = h3, el = h4;
    let ar = h0, br = h1, cr = h2, dr = h3, er = h4;
    for (let j = 0; j < 80; j++) {
      let t = (rotl((al + rf(j, bl, cl, dl) + X[RL[j]] + KL[j >> 4]) | 0, SL[j]) + el) | 0;
      al = el; el = dl; dl = rotl(cl, 10); cl = bl; bl = t;
      t = (rotl((ar + rf(79 - j, br, cr, dr) + X[RR[j]] + KR[j >> 4]) | 0, SR[j]) + er) | 0;
      ar = er; er = dr; dr = rotl(cr, 10); cr = br; br = t;
    }
    const t = (h1 + cl + dr) | 0;
    h1 = (h2 + dl + er) | 0;
    h2 = (h3 + el + ar) | 0;
    h3 = (h4 + al + br) | 0;
    h4 = (h0 + bl + cr) | 0;
    h0 = t;
  }
  const out = new Uint8Array(20);
  const ov = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => ov.setUint32(i * 4, h >>> 0, true));
  return out;
}

export const hash160 = (b) => ripemd160(sha256(b));

// BIP 340 tagged hash: SHA256(SHA256(tag) || SHA256(tag) || msg)
export function taggedHash(tag, ...msgs) {
  const t = sha256(new TextEncoder().encode(tag));
  return sha256(concat(t, t, ...msgs));
}

// ---------- Base58Check ----------

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Encode(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let n = bytes.length ? BigInt('0x' + (toHex(bytes) || '0')) : 0n;
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  return '1'.repeat(zeros) + out;
}

export function base58Decode(str) {
  let n = 0n;
  for (const c of str) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error(`“${c}” is not a Base58 character.`);
    n = n * 58n + BigInt(i);
  }
  let hex = n ? n.toString(16) : '';
  if (hex.length % 2) hex = '0' + hex;
  let zeros = 0;
  while (str[zeros] === '1') zeros++;
  return concat(new Uint8Array(zeros), fromHex(hex));
}

export const base58Check = (payload) => base58Encode(concat(payload, sha256(sha256(payload)).slice(0, 4)));

export function base58CheckDecode(str) {
  const raw = base58Decode(str);
  if (raw.length < 5) throw new Error('Too short.');
  const payload = raw.slice(0, -4);
  const sum = sha256(sha256(payload)).slice(0, 4);
  if (toHex(sum) !== toHex(raw.slice(-4))) throw new Error('Checksum mismatch: a character is wrong or missing.');
  return payload;
}

// ---------- Bech32 / Bech32m (BIP 173, BIP 350) ----------

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32 = 1;
const BECH32M = 0x2bc830a3;
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values) {
  let chk = 1;
  for (const v of values) {
    const b = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >>> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}
const hrpExpand = (hrp) => [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];

function convertBits(data, from, to, pad) {
  let acc = 0, bits = 0;
  const out = [];
  const maxv = (1 << to) - 1;
  for (const v of data) {
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) { bits -= to; out.push((acc >>> bits) & maxv); }
  }
  if (pad && bits) out.push((acc << (to - bits)) & maxv);
  else if (!pad && (bits >= from || ((acc << (to - bits)) & maxv))) throw new Error('Invalid padding.');
  return out;
}

export function segwitAddress(hrp, version, program) {
  const data = [version, ...convertBits(program, 8, 5, true)];
  const mod = polymod([...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ (version === 0 ? BECH32 : BECH32M);
  const checksum = [0, 1, 2, 3, 4, 5].map((i) => (mod >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...data, ...checksum].map((d) => CHARSET[d]).join('')}`;
}

export function decodeSegwitAddress(addr) {
  if (addr !== addr.toLowerCase() && addr !== addr.toUpperCase()) throw new Error('Mixed case.');
  const s = addr.toLowerCase();
  const pos = s.lastIndexOf('1');
  if (pos < 1 || pos + 7 > s.length) throw new Error('Not a Bech32 address.');
  const hrp = s.slice(0, pos);
  const data = [...s.slice(pos + 1)].map((c) => CHARSET.indexOf(c));
  if (data.includes(-1)) throw new Error('Invalid Bech32 character.');
  const check = polymod([...hrpExpand(hrp), ...data]);
  const version = data[0];
  if (check !== (version === 0 ? BECH32 : BECH32M)) throw new Error('Checksum mismatch.');
  return { hrp, version, program: Uint8Array.from(convertBits(data.slice(1, -6), 5, 8, false)) };
}

// ---------- keys ----------

const CURVE_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const bytesToBig = (b) => BigInt('0x' + toHex(b));

// 256 bits from crypto.getRandomValues (via noble). Optional user entropy
// (dice rolls, keyboard mashing) is hashed together with it, so it can only
// add randomness, never replace it.
export function generatePrivateKey(extraEntropy = '') {
  for (;;) {
    let key = utils.randomSecretKey();
    if (extraEntropy) key = sha256(concat(key, new TextEncoder().encode(extraEntropy)));
    const n = bytesToBig(key);
    if (n > 0n && n < CURVE_N) return key;
  }
}

export function toWif(priv, network = 'mainnet', compressed = true) {
  return base58Check(concat([NETWORKS[network].wif], priv, compressed ? [0x01] : []));
}

export function fromWif(wif) {
  const s = wif.trim();
  if (!s) throw new Error('Enter a private key.');
  let payload;
  try {
    payload = base58CheckDecode(s);
  } catch (err) {
    throw new Error(`Not a valid WIF private key: ${err.message}`);
  }
  const network = Object.keys(NETWORKS).find((k) => NETWORKS[k].wif === payload[0]);
  if (!network) throw new Error('Unknown network prefix; expected a mainnet (5, K, L) or testnet (9, c) key.');
  let compressed;
  if (payload.length === 34 && payload[33] === 0x01) compressed = true;
  else if (payload.length === 33) compressed = false;
  else throw new Error('Wrong length for a WIF private key.');
  const priv = payload.slice(1, 33);
  const n = bytesToBig(priv);
  if (n === 0n || n >= CURVE_N) throw new Error('Private key is out of range.');
  return { priv, network, compressed };
}

// BIP 86 key-path-only Taproot output key: Q = P + H_TapTweak(P)·G, with P
// the even-Y lift of the internal key's x coordinate.
export function taprootOutputKey(xOnly) {
  const P = Point.fromBytes(concat([0x02], xOnly));
  const t = bytesToBig(taggedHash('TapTweak', xOnly));
  if (t >= CURVE_N) throw new Error('Tweak out of range.');
  return Point.BASE.multiply(t).add(P).toBytes(true).slice(1);
}

export function deriveAddresses(priv, network = 'mainnet', compressed = true) {
  const net = NETWORKS[network];
  const pub = getPublicKey(priv, compressed);
  const pubC = compressed ? pub : getPublicKey(priv, true);
  const h = hash160(pub);
  const out = {
    pubkey: toHex(pub),
    p2pkh: base58Check(concat([net.p2pkh], h)),
  };
  // SegWit and Taproot require compressed keys.
  if (compressed) {
    const redeem = concat([0x00, 0x14], h);
    out['p2sh-p2wpkh'] = base58Check(concat([net.p2sh], hash160(redeem)));
    out.p2wpkh = segwitAddress(net.hrp, 0, h);
    out.p2tr = segwitAddress(net.hrp, 1, taprootOutputKey(pubC.slice(1)));
  }
  return out;
}

// ---------- output descriptors (BIP 380 checksum) ----------

const INPUT_CHARSET = '0123456789()[],\'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#"\\ ';

function descPolymod(c, val) {
  const c0 = c >> 35n;
  c = ((c & 0x7ffffffffn) << 5n) ^ val;
  if (c0 & 1n) c ^= 0xf5dee51989n;
  if (c0 & 2n) c ^= 0xa9fdca3312n;
  if (c0 & 4n) c ^= 0x1bab10e32dn;
  if (c0 & 8n) c ^= 0x3706b1677an;
  if (c0 & 16n) c ^= 0x644d626ffdn;
  return c;
}

export function descriptorChecksum(desc) {
  let c = 1n, cls = 0n, clsCount = 0;
  for (const ch of desc) {
    const pos = INPUT_CHARSET.indexOf(ch);
    if (pos < 0) throw new Error(`Invalid descriptor character “${ch}”.`);
    c = descPolymod(c, BigInt(pos & 31));
    cls = cls * 3n + BigInt(pos >> 5);
    if (++clsCount === 3) { c = descPolymod(c, cls); cls = 0n; clsCount = 0; }
  }
  if (clsCount > 0) c = descPolymod(c, cls);
  for (let j = 0; j < 8; j++) c = descPolymod(c, 0n);
  c ^= 1n;
  let out = '';
  for (let j = 0; j < 8; j++) out += CHARSET[Number((c >> (5n * BigInt(7 - j))) & 31n)];
  return out;
}

export const descriptorFor = (typeId, wif) => {
  const d = ADDRESS_TYPES.find((t) => t.id === typeId).descriptor(wif);
  return `${d}#${descriptorChecksum(d)}`;
};

