// QR Code encoder (ISO/IEC 18004): numeric, alphanumeric and byte (UTF-8)
// modes, versions 1–40, error-correction levels L/M/Q/H, automatic mask
// selection. Pure functions, no DOM.
//
//   const qr = encodeQr('https://example.com', { ecc: 'M' });
//   qr.size, qr.version, qr.ecc, qr.isDark(x, y)

export const ECC_LEVELS = {
  L: { ordinal: 0, formatBits: 1, recovery: '~7%' },
  M: { ordinal: 1, formatBits: 0, recovery: '~15%' },
  Q: { ordinal: 2, formatBits: 3, recovery: '~25%' },
  H: { ordinal: 3, formatBits: 2, recovery: '~30%' },
};
const ECC_ORDER = ['L', 'M', 'Q', 'H'];

// Per version (index 1–40), per level: error-correction codewords per block
// and number of blocks (ISO/IEC 18004 Table 9).
const ECC_CODEWORDS_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_ERROR_CORRECTION_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const MODES = {
  numeric: { indicator: 0x1, ccBits: [10, 12, 14] },
  alphanumeric: { indicator: 0x2, ccBits: [9, 11, 13] },
  byte: { indicator: 0x4, ccBits: [8, 16, 16] },
};
const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

const ccBits = (mode, version) => MODES[mode].ccBits[version <= 9 ? 0 : version <= 26 ? 1 : 2];

// ---------- capacity ----------

// Modules available for data + ECC after function patterns are excluded.
function numRawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

export function numDataCodewords(ver, ecc) {
  const o = ECC_LEVELS[ecc].ordinal;
  return Math.floor(numRawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[o][ver] * NUM_ERROR_CORRECTION_BLOCKS[o][ver];
}

// ---------- data encoding ----------

function chooseMode(text) {
  if (/^[0-9]*$/.test(text)) return 'numeric';
  if ([...text].every((c) => ALNUM.includes(c))) return 'alphanumeric';
  return 'byte';
}

class BitBuffer {
  constructor() { this.bits = []; }
  append(value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
}

function encodeSegment(text, mode) {
  const bb = new BitBuffer();
  let count;
  if (mode === 'numeric') {
    count = text.length;
    for (let i = 0; i < text.length; i += 3) {
      const chunk = text.substr(i, 3);
      bb.append(parseInt(chunk, 10), chunk.length * 3 + 1);
    }
  } else if (mode === 'alphanumeric') {
    count = text.length;
    for (let i = 0; i + 1 < text.length; i += 2) bb.append(ALNUM.indexOf(text[i]) * 45 + ALNUM.indexOf(text[i + 1]), 11);
    if (text.length % 2) bb.append(ALNUM.indexOf(text[text.length - 1]), 6);
  } else {
    const bytes = new TextEncoder().encode(text);
    count = bytes.length;
    for (const b of bytes) bb.append(b, 8);
  }
  return { mode, count, bits: bb.bits };
}

const segmentBits = (seg, ver) => 4 + ccBits(seg.mode, ver) + seg.bits.length;

// ---------- Reed–Solomon over GF(256), polynomial 0x11D ----------

function gfMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

export function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMultiply(coef, factor); });
  }
  return result;
}

// Split into blocks, append ECC to each, interleave (ISO/IEC 18004 §7.6).
export function addEccAndInterleave(data, ver, ecc) {
  const o = ECC_LEVELS[ecc].ordinal;
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[o][ver];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[o][ver];
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const divisor = rsDivisor(blockEccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const eccBytes = rsRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(eccBytes));
  }
  const result = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
    });
  }
  return result;
}

// ---------- matrix construction ----------

function alignmentPositions(ver) {
  if (ver === 1) return [];
  const size = ver * 4 + 17;
  const numAlign = Math.floor(ver / 7) + 2;
  const step = Math.floor((ver * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

const getBit = (x, i) => ((x >>> i) & 1) !== 0;

class Matrix {
  constructor(ver) {
    this.size = ver * 4 + 17;
    this.modules = new Uint8Array(this.size * this.size);
    this.isFunction = new Uint8Array(this.size * this.size);
  }
  get(x, y) { return this.modules[y * this.size + x] === 1; }
  set(x, y, dark) { this.modules[y * this.size + x] = dark ? 1 : 0; }
  setFunction(x, y, dark) { this.set(x, y, dark); this.isFunction[y * this.size + x] = 1; }
}

function drawFunctionPatterns(m, ver, ecc) {
  const { size } = m;
  for (let i = 0; i < size; i++) {
    m.setFunction(6, i, i % 2 === 0);
    m.setFunction(i, 6, i % 2 === 0);
  }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) m.setFunction(x, y, dist !== 2 && dist !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);

  const pos = alignmentPositions(ver);
  const n = pos.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) m.setFunction(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }
  drawFormatBits(m, ecc, 0); // reserve the area; redrawn once the mask is chosen
  drawVersion(m, ver);
}

export function formatBits(ecc, mask) {
  const data = (ECC_LEVELS[ecc].formatBits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function drawFormatBits(m, ecc, mask) {
  const bits = formatBits(ecc, mask);
  const { size } = m;
  for (let i = 0; i <= 5; i++) m.setFunction(8, i, getBit(bits, i));
  m.setFunction(8, 7, getBit(bits, 6));
  m.setFunction(8, 8, getBit(bits, 7));
  m.setFunction(7, 8, getBit(bits, 8));
  for (let i = 9; i < 15; i++) m.setFunction(14 - i, 8, getBit(bits, i));
  for (let i = 0; i < 8; i++) m.setFunction(size - 1 - i, 8, getBit(bits, i));
  for (let i = 8; i < 15; i++) m.setFunction(8, size - 15 + i, getBit(bits, i));
  m.setFunction(8, size - 8, true); // always-dark module
}

function drawVersion(m, ver) {
  if (ver < 7) return;
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (ver << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const bit = getBit(bits, i);
    const a = m.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    m.setFunction(a, b, bit);
    m.setFunction(b, a, bit);
  }
}

function drawCodewords(m, data) {
  const { size } = m;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing column
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!m.isFunction[y * size + x] && i < data.length * 8) {
          m.set(x, y, getBit(data[i >>> 3], 7 - (i & 7)));
          i++;
        }
      }
    }
  }
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(m, mask) {
  const fn = MASKS[mask];
  for (let y = 0; y < m.size; y++) {
    for (let x = 0; x < m.size; x++) {
      if (!m.isFunction[y * m.size + x] && fn(x, y)) m.modules[y * m.size + x] ^= 1;
    }
  }
}

// Penalty rules N1–N4 (ISO/IEC 18004 §7.8.3). Only affects which mask is
// chosen, never whether the code decodes.
function penalty(m) {
  const { size } = m;
  const at = (x, y) => m.modules[y * size + x];
  let score = 0;
  const FINDER_A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const FINDER_B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const line = (get) => {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && get(i) === get(i - 1)) { run++; continue; }
      if (run >= 5) score += 3 + (run - 5);
      run = 1;
    }
    for (let i = 0; i + 11 <= size; i++) {
      let a = true, b = true;
      for (let k = 0; k < 11; k++) {
        const v = get(i + k);
        if (v !== FINDER_A[k]) a = false;
        if (v !== FINDER_B[k]) b = false;
      }
      if (a) score += 40;
      if (b) score += 40;
    }
  };
  for (let y = 0; y < size; y++) line((x) => at(x, y));
  for (let x = 0; x < size; x++) line((y) => at(x, y));
  for (let y = 0; y + 1 < size; y++) {
    for (let x = 0; x + 1 < size; x++) {
      const c = at(x, y);
      if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1)) score += 3;
    }
  }
  let dark = 0;
  for (const v of m.modules) dark += v;
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

// ---------- public API ----------

export class QrTooLongError extends Error {}

// Largest payload (in bytes, for the chosen mode) that fits at `ecc`.
export function maxCapacity(ecc, mode = 'byte') {
  const bits = numDataCodewords(40, ecc) * 8 - 4 - ccBits(mode, 40);
  if (mode === 'numeric') return Math.floor(bits / 10) * 3 + (bits % 10 >= 7 ? 2 : bits % 10 >= 4 ? 1 : 0);
  if (mode === 'alphanumeric') return Math.floor(bits / 11) * 2 + (bits % 11 >= 6 ? 1 : 0);
  return Math.floor(bits / 8);
}

export function encodeQr(text, { ecc = 'M', minVersion = 1, maxVersion = 40, mask = -1, boostEcc = true } = {}) {
  if (!ECC_LEVELS[ecc]) throw new Error(`Unknown error-correction level: ${ecc}`);
  const mode = chooseMode(text);
  const seg = encodeSegment(text, mode);

  let version;
  for (version = minVersion; ; version++) {
    if (version > maxVersion) {
      throw new QrTooLongError(`Too much data for a QR code at error correction ${ecc}: ${seg.count.toLocaleString()} ${mode === 'byte' ? 'bytes' : 'characters'}, maximum ${maxCapacity(ecc, mode).toLocaleString()}.`);
    }
    const capacity = numDataCodewords(version, ecc) * 8;
    if (seg.count < 2 ** ccBits(mode, version) && segmentBits(seg, version) <= capacity) break;
  }
  const used = segmentBits(seg, version);
  const requested = ecc;
  if (boostEcc) {
    // Use a stronger level whenever it still fits in the same version.
    for (const lvl of ECC_ORDER.slice(ECC_ORDER.indexOf(ecc) + 1)) {
      if (used <= numDataCodewords(version, lvl) * 8) ecc = lvl;
    }
  }

  const capacityBits = numDataCodewords(version, ecc) * 8;
  const bb = new BitBuffer();
  bb.append(MODES[mode].indicator, 4);
  bb.append(seg.count, ccBits(mode, version));
  bb.bits.push(...seg.bits);
  bb.append(0, Math.min(4, capacityBits - bb.bits.length));
  bb.append(0, (8 - (bb.bits.length % 8)) % 8);
  for (let pad = 0xec; bb.bits.length < capacityBits; pad ^= 0xec ^ 0x11) bb.append(pad, 8);

  const data = [];
  for (let i = 0; i < bb.bits.length; i += 8) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | bb.bits[i + k];
    data.push(b);
  }

  const m = new Matrix(version);
  drawFunctionPatterns(m, version, ecc);
  drawCodewords(m, addEccAndInterleave(data, version, ecc));

  let chosen = mask;
  if (chosen < 0) {
    let best = Infinity;
    for (let k = 0; k < 8; k++) {
      applyMask(m, k);
      drawFormatBits(m, ecc, k);
      const p = penalty(m);
      if (p < best) { best = p; chosen = k; }
      applyMask(m, k); // XOR again to undo
    }
  }
  applyMask(m, chosen);
  drawFormatBits(m, ecc, chosen);

  const { size, modules, isFunction } = m;
  return {
    version,
    size,
    ecc,
    requestedEcc: requested,
    mask: chosen,
    mode,
    dataBytes: Math.ceil(used / 8),
    capacityBytes: numDataCodewords(version, ecc),
    modules,
    isFunction,
    isDark: (x, y) => modules[y * size + x] === 1,
  };
}

// True for modules inside the three 7×7 finder patterns ("eyes").
export function isFinder(size, x, y) {
  return (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);
}
