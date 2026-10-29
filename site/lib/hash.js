// MD5 and SHA-2 (256/384/512) message digests.
//
// WebCrypto's crypto.subtle only exists in secure contexts (HTTPS or
// localhost), so a plain-HTTP LAN deployment needs these pure-JS versions.
// hashBytes() prefers WebCrypto when present and falls back otherwise.
// Every implementation is incremental: update() any number of times, then digest().

export const ALGORITHMS = [
  { id: 'md5', label: 'MD5', bits: 128, insecure: true },
  { id: 'sha-256', label: 'SHA-256', bits: 256 },
  { id: 'sha-384', label: 'SHA-384', bits: 384 },
  { id: 'sha-512', label: 'SHA-512', bits: 512 },
];

// ---------- constants ----------

// SHA-2 constants are the fractional bits of square/cube roots of primes
// (FIPS 180-4 §4.2, §5.3). Deriving them avoids hand-copied magic tables.
function firstPrimes(n) {
  const out = [];
  for (let c = 2; out.length < n; c++) if (out.every((p) => c % p)) out.push(c);
  return out;
}

function iroot(n, k) {
  const K = BigInt(k);
  let x = BigInt(Math.ceil(Number(n) ** (1 / k)));
  x += (x >> 16n) + 2n; // start above the true root so Newton descends to it
  for (;;) {
    const y = ((K - 1n) * x + n / x ** (K - 1n)) / K;
    if (y >= x) break;
    x = y;
  }
  while (x ** K > n) x--;
  while ((x + 1n) ** K <= n) x++;
  return x;
}

// floor(frac(p^(1/k)) * 2^bits)
const fracRoot = (p, k, bits) =>
  iroot(BigInt(p) << BigInt(bits * k), k) & ((1n << BigInt(bits)) - 1n);

const PRIMES = firstPrimes(80);
const split64 = (big) => [Number(big >> 32n), Number(big & 0xffffffffn)];

const K256 = Uint32Array.from(PRIMES.slice(0, 64), (p) => Number(fracRoot(p, 3, 32)));
const IV256 = Uint32Array.from(PRIMES.slice(0, 8), (p) => Number(fracRoot(p, 2, 32)));
const K512 = Uint32Array.from(PRIMES.flatMap((p) => split64(fracRoot(p, 3, 64))));
const IV512 = Uint32Array.from(PRIMES.slice(0, 8).flatMap((p) => split64(fracRoot(p, 2, 64))));
const IV384 = Uint32Array.from(PRIMES.slice(8, 16).flatMap((p) => split64(fracRoot(p, 2, 64))));

// RFC 1321 §3.4: T[i] = floor(abs(sin(i + 1)) * 2^32). Tabulated rather than
// computed because Math.sin is not guaranteed bit-exact across engines.
const MD5_T = new Uint32Array([
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
]);
const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

// ---------- Merkle–Damgård framing (buffering + padding) ----------

class BlockHasher {
  constructor(blockSize, lengthBytes, littleEndian) {
    this.blockSize = blockSize;
    this.lengthBytes = lengthBytes;
    this.littleEndian = littleEndian;
    this.buf = new Uint8Array(blockSize);
    this.pos = 0;
    this.length = 0;
  }

  update(data) {
    const bs = this.blockSize;
    const n = data.length;
    let i = 0;
    this.length += n;
    if (this.pos) {
      i = Math.min(bs - this.pos, n);
      this.buf.set(data.subarray(0, i), this.pos);
      this.pos += i;
      if (this.pos < bs) return this;
      this.compress(this.buf, 0);
      this.pos = 0;
    }
    for (; i + bs <= n; i += bs) this.compress(data, i);
    if (i < n) {
      this.buf.set(data.subarray(i), 0);
      this.pos = n - i;
    }
    return this;
  }

  digest() {
    const bs = this.blockSize;
    const hi = Math.floor(this.length / 0x20000000); // bit length >> 32
    const lo = (this.length * 8) >>> 0;
    const pad = new Uint8Array(((this.pos + 1 + this.lengthBytes > bs) ? 2 * bs : bs) - this.pos);
    pad[0] = 0x80;
    const v = new DataView(pad.buffer);
    const end = pad.length;
    if (this.littleEndian) {
      v.setUint32(end - 8, lo, true);
      v.setUint32(end - 4, hi, true);
    } else {
      v.setUint32(end - 8, hi);
      v.setUint32(end - 4, lo);
    }
    this.update(pad);
    return this.output();
  }
}

// ---------- MD5 ----------

class MD5 extends BlockHasher {
  constructor() {
    super(64, 8, true);
    this.h = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
    this.x = new Uint32Array(16);
  }

  compress(d, o) {
    const x = this.x;
    for (let i = 0; i < 16; i++) {
      const j = o + i * 4;
      x[i] = d[j] | (d[j + 1] << 8) | (d[j + 2] << 16) | (d[j + 3] << 24);
    }
    let [a, b, c, dd] = this.h;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & dd); g = i; }
      else if (i < 32) { f = (dd & b) | (~dd & c); g = (5 * i + 1) & 15; }
      else if (i < 48) { f = b ^ c ^ dd; g = (3 * i + 5) & 15; }
      else { f = c ^ (b | ~dd); g = (7 * i) & 15; }
      const s = MD5_S[(i >> 4) * 4 + (i & 3)];
      const t = (a + f + MD5_T[i] + x[g]) | 0;
      a = dd;
      dd = c;
      c = b;
      b = (b + ((t << s) | (t >>> (32 - s)))) | 0;
    }
    this.h[0] += a; this.h[1] += b; this.h[2] += c; this.h[3] += dd;
  }

  output() {
    const out = new Uint8Array(16);
    const v = new DataView(out.buffer);
    this.h.forEach((w, i) => v.setUint32(i * 4, w, true));
    return out;
  }
}

// ---------- SHA-256 ----------

const rotr = (x, n) => (x >>> n) | (x << (32 - n));

class SHA256 extends BlockHasher {
  constructor() {
    super(64, 8, false);
    this.h = IV256.slice();
    this.w = new Uint32Array(64);
  }

  compress(d, o) {
    const w = this.w;
    for (let i = 0; i < 16; i++) {
      const j = o + i * 4;
      w[i] = (d[j] << 24) | (d[j + 1] << 16) | (d[j + 2] << 8) | d[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    let [a, b, c, dd, e, f, g, h] = this.h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (dd + t1) | 0;
      dd = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    const H = this.h;
    H[0] += a; H[1] += b; H[2] += c; H[3] += dd; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }

  output() {
    const out = new Uint8Array(32);
    const v = new DataView(out.buffer);
    this.h.forEach((x, i) => v.setUint32(i * 4, x));
    return out;
  }
}

// ---------- SHA-512 / SHA-384 (64-bit words as hi/lo uint32 pairs) ----------

const rotrHi = (h, l, n) => (n < 32 ? (h >>> n) | (l << (32 - n)) : (l >>> (n - 32)) | (h << (64 - n))) >>> 0;
const rotrLo = (h, l, n) => (n < 32 ? (l >>> n) | (h << (32 - n)) : (h >>> (n - 32)) | (l << (64 - n))) >>> 0;
const TWO32 = 0x100000000;

class SHA512 extends BlockHasher {
  constructor(iv = IV512, outBytes = 64) {
    super(128, 16, false);
    this.h = iv.slice();
    this.w = new Uint32Array(160);
    this.outBytes = outBytes;
  }

  compress(d, o) {
    const w = this.w;
    for (let i = 0; i < 32; i++) {
      const j = o + i * 4;
      w[i] = (d[j] << 24) | (d[j + 1] << 16) | (d[j + 2] << 8) | d[j + 3];
    }
    for (let i = 16; i < 80; i++) {
      let xh = w[(i - 15) * 2], xl = w[(i - 15) * 2 + 1];
      const s0h = (rotrHi(xh, xl, 1) ^ rotrHi(xh, xl, 8) ^ (xh >>> 7)) >>> 0;
      const s0l = (rotrLo(xh, xl, 1) ^ rotrLo(xh, xl, 8) ^ ((xl >>> 7) | (xh << 25))) >>> 0;
      xh = w[(i - 2) * 2]; xl = w[(i - 2) * 2 + 1];
      const s1h = (rotrHi(xh, xl, 19) ^ rotrHi(xh, xl, 61) ^ (xh >>> 6)) >>> 0;
      const s1l = (rotrLo(xh, xl, 19) ^ rotrLo(xh, xl, 61) ^ ((xl >>> 6) | (xh << 26))) >>> 0;
      const lo = s1l + w[(i - 7) * 2 + 1] + s0l + w[(i - 16) * 2 + 1];
      w[i * 2 + 1] = lo;
      w[i * 2] = s1h + w[(i - 7) * 2] + s0h + w[(i - 16) * 2] + Math.floor(lo / TWO32);
    }

    const H = this.h;
    let ah = H[0], al = H[1], bh = H[2], bl = H[3], ch = H[4], cl = H[5], dh = H[6], dl = H[7];
    let eh = H[8], el = H[9], fh = H[10], fl = H[11], gh = H[12], gl = H[13], hh = H[14], hl = H[15];

    for (let i = 0; i < 80; i++) {
      const S1h = (rotrHi(eh, el, 14) ^ rotrHi(eh, el, 18) ^ rotrHi(eh, el, 41)) >>> 0;
      const S1l = (rotrLo(eh, el, 14) ^ rotrLo(eh, el, 18) ^ rotrLo(eh, el, 41)) >>> 0;
      const chh = ((eh & fh) ^ (~eh & gh)) >>> 0;
      const chl = ((el & fl) ^ (~el & gl)) >>> 0;
      const t1lo = hl + S1l + chl + K512[i * 2 + 1] + w[i * 2 + 1];
      const t1h = (hh + S1h + chh + K512[i * 2] + w[i * 2] + Math.floor(t1lo / TWO32)) >>> 0;
      const t1l = t1lo >>> 0;

      const S0h = (rotrHi(ah, al, 28) ^ rotrHi(ah, al, 34) ^ rotrHi(ah, al, 39)) >>> 0;
      const S0l = (rotrLo(ah, al, 28) ^ rotrLo(ah, al, 34) ^ rotrLo(ah, al, 39)) >>> 0;
      const majh = ((ah & bh) ^ (ah & ch) ^ (bh & ch)) >>> 0;
      const majl = ((al & bl) ^ (al & cl) ^ (bl & cl)) >>> 0;
      const t2lo = S0l + majl;
      const t2h = (S0h + majh + Math.floor(t2lo / TWO32)) >>> 0;
      const t2l = t2lo >>> 0;

      hh = gh; hl = gl; gh = fh; gl = fl; fh = eh; fl = el;
      const elo = dl + t1l;
      eh = (dh + t1h + Math.floor(elo / TWO32)) >>> 0; el = elo >>> 0;
      dh = ch; dl = cl; ch = bh; cl = bl; bh = ah; bl = al;
      const alo = t1l + t2l;
      ah = (t1h + t2h + Math.floor(alo / TWO32)) >>> 0; al = alo >>> 0;
    }

    const add = (k, xh, xl) => {
      const lo = H[k + 1] + xl;
      H[k] = H[k] + xh + Math.floor(lo / TWO32);
      H[k + 1] = lo;
    };
    add(0, ah, al); add(2, bh, bl); add(4, ch, cl); add(6, dh, dl);
    add(8, eh, el); add(10, fh, fl); add(12, gh, gl); add(14, hh, hl);
  }

  output() {
    const full = new Uint8Array(64);
    const v = new DataView(full.buffer);
    this.h.forEach((x, i) => v.setUint32(i * 4, x));
    return full.slice(0, this.outBytes);
  }
}

// ---------- public API ----------

export function createHasher(alg) {
  switch (alg) {
    case 'md5': return new MD5();
    case 'sha-256': return new SHA256();
    case 'sha-384': return new SHA512(IV384, 48);
    case 'sha-512': return new SHA512(IV512, 64);
    default: throw new Error(`Unknown algorithm: ${alg}`);
  }
}

export const hashBytesSync = (alg, bytes) => createHasher(alg).update(bytes).digest();

const subtle = globalThis.crypto?.subtle;

export async function hashBytes(alg, bytes) {
  if (alg !== 'md5' && subtle) {
    try {
      return new Uint8Array(await subtle.digest(alg.toUpperCase(), bytes));
    } catch { /* fall back to the pure-JS path */ }
  }
  return hashBytesSync(alg, bytes);
}

export const toHex = (bytes, upper = false) => {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return upper ? s.toUpperCase() : s;
};

// Normalise a pasted digest (hex any case, optional spaces/colons, or base64)
// to lowercase hex for comparison. Returns null when it isn't recognisable.
export function normalizeDigest(input) {
  const s = input.trim();
  if (!s) return null;
  const hex = s.replace(/[\s:]/g, '');
  if (/^[0-9a-f]+$/i.test(hex) && hex.length % 2 === 0) return hex.toLowerCase();
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '').padEnd(Math.ceil(s.length / 4) * 4, '='));
    let out = '';
    for (let i = 0; i < bin.length; i++) out += bin.charCodeAt(i).toString(16).padStart(2, '0');
    return out;
  } catch {
    return null;
  }
}
