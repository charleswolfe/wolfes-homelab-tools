// Image conversion helpers that don't touch the DOM: format sniffing, resize
// maths, output names and a minimal ZIP writer for "download all".

export const OUTPUT_FORMATS = [
  { id: 'png', label: 'PNG', mime: 'image/png', ext: 'png', lossy: false, alpha: true },
  { id: 'jpeg', label: 'JPEG', mime: 'image/jpeg', ext: 'jpg', lossy: true, alpha: false },
  { id: 'webp', label: 'WebP', mime: 'image/webp', ext: 'webp', lossy: true, alpha: true },
  { id: 'avif', label: 'AVIF', mime: 'image/avif', ext: 'avif', lossy: true, alpha: true },
];

const ascii = (b, start, len) => String.fromCharCode(...b.subarray(start, start + len));

// Identify an image from its first bytes, so the page can name the input
// format even when the browser can't decode it (HEIC outside Safari, TIFF).
export function sniffFormat(b) {
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return 'PNG';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'JPEG';
  if (b.length >= 6 && /^GIF8[79]a$/.test(ascii(b, 0, 6))) return 'GIF';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'WebP';
  if (b.length >= 2 && ascii(b, 0, 2) === 'BM') return 'BMP';
  if (b.length >= 4 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'ICO';
  if (b.length >= 4 && (ascii(b, 0, 4) === 'II*\0' || ascii(b, 0, 4) === 'MM\0*')) return 'TIFF';
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (brand === 'avif' || brand === 'avis') return 'AVIF';
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(brand)) return 'HEIC';
  }
  const head = new TextDecoder().decode(b.subarray(0, 512)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'SVG';
  return null;
}

// Natural size of an SVG: its width/height in px, else its viewBox scaled so
// the long side is `fallback` px. Browsers give a sizeless SVG a 150×150 box,
// far too small to rasterise a logo or icon from.
export function svgSize(text, fallback = 1024) {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0];
  if (!tag) return null;
  const attr = (name) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1]?.trim();
  const px = (v) => (v && /^\d+(\.\d+)?(px)?$/.test(v) ? parseFloat(v) : 0);
  const width = px(attr('width'));
  const height = px(attr('height'));
  const vb = (attr('viewBox') || '').split(/[\s,]+/).map(Number);
  const ratio = vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? vb[2] / vb[3] : 0;
  if (width && height) return { width: Math.round(width), height: Math.round(height) };
  if (width && ratio) return { width: Math.round(width), height: Math.round(width / ratio) };
  if (height && ratio) return { width: Math.round(height * ratio), height: Math.round(height) };
  if (ratio) return ratio >= 1 ? { width: fallback, height: Math.round(fallback / ratio) } : { width: Math.round(fallback * ratio), height: fallback };
  return { width: fallback, height: fallback };
}

// Target size for the resize options. Fitting never enlarges unless asked,
// and both sides stay at least 1 px.
export function targetSize(w, h, { mode = 'original', scale = 100, maxWidth = 0, maxHeight = 0, enlarge = false } = {}) {
  let f = 1;
  if (mode === 'scale') f = scale / 100;
  else if (mode === 'fit') {
    const fw = maxWidth > 0 ? maxWidth / w : Infinity;
    const fh = maxHeight > 0 ? maxHeight / h : Infinity;
    f = Math.min(fw, fh);
    if (!Number.isFinite(f)) f = 1;
    if (!enlarge) f = Math.min(f, 1);
  }
  return { width: Math.max(1, Math.round(w * f)), height: Math.max(1, Math.round(h * f)) };
}

// Halving steps for a large downscale. One big drawImage reduction skips
// pixels and looks jagged; repeated halving averages them like a box filter.
export function downscaleSteps(fromW, fromH, toW, toH) {
  const steps = [];
  let w = fromW;
  let h = fromH;
  while (w / 2 >= toW && h / 2 >= toH) {
    w = Math.round(w / 2);
    h = Math.round(h / 2);
    steps.push({ width: w, height: h });
  }
  steps.push({ width: toW, height: toH });
  return steps;
}

export function outputName(name, ext, taken = new Set()) {
  const base = (name.replace(/\.[^./\\]+$/, '') || 'image').replace(/[\\/:*?"<>|]/g, '_');
  let candidate = `${base}.${ext}`;
  for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = `${base}-${i}.${ext}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

export function sizeChange(before, after) {
  if (!before) return '';
  const pct = Math.round((after / before - 1) * 100);
  if (pct === 0) return 'same size';
  if (pct < 0) return `${-pct}% smaller`;
  const ratio = after / before;
  // Past double, a multiple reads better than "12193% larger".
  return ratio >= 2 ? `${ratio < 10 ? ratio.toFixed(1) : Math.round(ratio)}× larger` : `${pct}% larger`;
}

// ---------- ZIP (stored, no compression: images are already compressed) ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

// entries: [{ name, data: Uint8Array }]. Names are UTF-8 (flag bit 11).
export function makeZip(entries, when = new Date()) {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(when);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);        // version needed
    local.setUint16(6, 0x0800, true);    // UTF-8 names
    local.setUint16(8, 0, true);         // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    locals.push(new Uint8Array(local.buffer), nameBytes, data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);      // version made by
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, time, true);
    central.setUint16(14, date, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}
