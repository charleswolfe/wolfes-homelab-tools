// Renders an encoded QR (from qr.js) as SVG markup or onto a 2D canvas.
// Both outputs share one layout so PNG and SVG downloads look identical.
import { isFinder } from './qr.js';

export const MODULE_STYLES = ['square', 'rounded', 'dots'];
export const MAX_LOGO_RATIO = 0.3; // logo width ≤ 30% of the symbol (≈9% of its area)

// Geometry in module units, origin at the top-left of the quiet zone.
export function layout(qr, { margin = 4, style = 'square', logoRatio = 0 } = {}) {
  const total = qr.size + margin * 2;
  let logo = null;
  if (logoRatio > 0) {
    const w = Math.min(logoRatio, MAX_LOGO_RATIO) * qr.size;
    const start = (qr.size - w) / 2;
    logo = { x: margin + start, y: margin + start, w };
  }
  // Clear modules under the logo (plus half a module of breathing room);
  // error correction rebuilds the missing data.
  const pad = 0.5;
  const covered = (x, y) => logo
    && x + 1 > logo.x - margin - pad && x < logo.x - margin + logo.w + pad
    && y + 1 > logo.y - margin - pad && y < logo.y - margin + logo.w + pad;

  const separateEyes = style !== 'square';
  const modules = [];
  // With dots, timing/alignment/format modules stay solid squares: decoders
  // use them to lock onto the grid, and fully dotted codes fail on weaker
  // scanners (jsQR read 26/80 dotted vs 80/80 with solid function patterns).
  const solid = [];
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (!qr.isDark(x, y) || covered(x, y)) continue;
      if (separateEyes && isFinder(qr.size, x, y)) continue;
      if (style === 'dots' && qr.isFunction[y * qr.size + x]) solid.push([x + margin, y + margin]);
      else modules.push([x + margin, y + margin]);
    }
  }
  const eyes = separateEyes ? [[0, 0], [qr.size - 7, 0], [0, qr.size - 7]].map(([x, y]) => [x + margin, y + margin]) : [];
  return { total, margin, style, modules, solid, eyes, logo };
}

// ---------- SVG ----------

const num = (n) => +n.toFixed(3);

function modulePath(lay) {
  const { modules, style } = lay;
  if (style === 'dots') {
    const r = 0.45;
    return modules.map(([x, y]) => `M${num(x + 0.5 - r)} ${y + 0.5}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0z`).join('');
  }
  if (style === 'rounded') {
    const r = 0.3;
    const s = 1 - 2 * r;
    return modules.map(([x, y]) => `M${num(x + r)} ${y}h${num(s)}a${r} ${r} 0 0 1 ${r} ${r}v${num(s)}a${r} ${r} 0 0 1 ${-r} ${r}h${num(-s)}a${r} ${r} 0 0 1 ${-r} ${-r}v${num(-s)}a${r} ${r} 0 0 1 ${r} ${-r}z`).join('');
  }
  // Square: merge horizontal runs into one rectangle each.
  const rows = new Map();
  for (const [x, y] of modules) {
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push(x);
  }
  let d = '';
  for (const [y, xs] of rows) {
    xs.sort((a, b) => a - b);
    for (let i = 0; i < xs.length;) {
      let j = i;
      while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++;
      const len = j - i + 1;
      d += `M${xs[i]} ${y}h${len}v1h${-len}z`;
      i = j + 1;
    }
  }
  return d;
}

function roundRectPath(x, y, w, h, r) {
  return `M${num(x + r)} ${num(y)}h${num(w - 2 * r)}a${r} ${r} 0 0 1 ${r} ${r}v${num(h - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${r}h${num(-(w - 2 * r))}a${r} ${r} 0 0 1 ${-r} ${-r}v${num(-(h - 2 * r))}a${r} ${r} 0 0 1 ${r} ${-r}z`;
}

function eyePath(lay) {
  const outerR = lay.style === 'dots' ? 2.2 : 1.6;
  const innerR = lay.style === 'dots' ? 1.5 : 1;
  return lay.eyes.map(([x, y]) =>
    roundRectPath(x, y, 7, 7, outerR) + roundRectPath(x + 1, y + 1, 5, 5, Math.max(outerR - 0.8, 0.4)) + roundRectPath(x + 2, y + 2, 3, 3, innerR),
  ).join('');
}

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function toSvg(lay, { fg = '#000000', bg = '#ffffff', transparent = false, sizePx = 1024, logoHref = null, logoPlate = true } = {}) {
  const { total, logo } = lay;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${sizePx}" height="${sizePx}"${lay.style === 'square' ? ' shape-rendering="crispEdges"' : ''}>`];
  if (!transparent) parts.push(`<rect width="${total}" height="${total}" fill="${escAttr(bg)}"/>`);
  parts.push(`<path fill="${escAttr(fg)}" d="${modulePath(lay)}${lay.solid.map(([x, y]) => `M${x} ${y}h1v1h-1z`).join('')}"/>`);
  if (lay.eyes.length) parts.push(`<path fill="${escAttr(fg)}" fill-rule="evenodd" d="${eyePath(lay)}"/>`);
  if (logo && logoHref) {
    if (logoPlate) parts.push(`<rect x="${num(logo.x - 0.5)}" y="${num(logo.y - 0.5)}" width="${num(logo.w + 1)}" height="${num(logo.w + 1)}" rx="0.8" fill="${escAttr(transparent ? '#ffffff' : bg)}"/>`);
    parts.push(`<image href="${escAttr(logoHref)}" x="${num(logo.x)}" y="${num(logo.y)}" width="${num(logo.w)}" height="${num(logo.w)}" preserveAspectRatio="xMidYMid meet"/>`);
  }
  parts.push('</svg>');
  return parts.join('');
}

// ---------- canvas ----------

// Integer pixels per module keeps edges crisp; returns the canvas size used.
export function canvasSizeFor(lay, targetPx) {
  const scale = Math.max(1, Math.round(targetPx / lay.total));
  return { scale, px: scale * lay.total };
}

function canvasRoundRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function paintCanvas(ctx, lay, { scale, fg = '#000000', bg = '#ffffff', transparent = false, logoImage = null, logoPlate = true }) {
  const s = scale;
  const px = lay.total * s;
  ctx.clearRect(0, 0, px, px);
  if (!transparent) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, px, px);
  }
  ctx.fillStyle = fg;
  ctx.beginPath();
  if (lay.style === 'square') {
    for (const [x, y] of lay.modules) ctx.rect(x * s, y * s, s, s);
  } else if (lay.style === 'dots') {
    for (const [x, y] of lay.modules) {
      ctx.moveTo((x + 0.95) * s, (y + 0.5) * s);
      ctx.arc((x + 0.5) * s, (y + 0.5) * s, 0.45 * s, 0, Math.PI * 2);
    }
  } else {
    for (const [x, y] of lay.modules) canvasRoundRect(ctx, x * s, y * s, s, s, 0.3 * s);
  }
  for (const [x, y] of lay.solid) ctx.rect(x * s, y * s, s, s);
  ctx.fill();

  if (lay.eyes.length) {
    const outerR = lay.style === 'dots' ? 2.2 : 1.6;
    const innerR = lay.style === 'dots' ? 1.5 : 1;
    ctx.beginPath();
    for (const [x, y] of lay.eyes) {
      canvasRoundRect(ctx, x * s, y * s, 7 * s, 7 * s, outerR * s);
      canvasRoundRect(ctx, (x + 1) * s, (y + 1) * s, 5 * s, 5 * s, Math.max(outerR - 0.8, 0.4) * s);
      canvasRoundRect(ctx, (x + 2) * s, (y + 2) * s, 3 * s, 3 * s, innerR * s);
    }
    ctx.fill('evenodd');
  }

  if (lay.logo && logoImage) {
    const { x, y, w } = lay.logo;
    if (logoPlate) {
      ctx.fillStyle = transparent ? '#ffffff' : bg;
      ctx.beginPath();
      canvasRoundRect(ctx, (x - 0.5) * s, (y - 0.5) * s, (w + 1) * s, (w + 1) * s, 0.8 * s);
      ctx.fill();
    }
    // Fit the image inside the square, preserving its aspect ratio.
    const iw = logoImage.naturalWidth || logoImage.width;
    const ih = logoImage.naturalHeight || logoImage.height;
    const k = Math.min(w / iw, w / ih);
    const dw = iw * k, dh = ih * k;
    ctx.drawImage(logoImage, (x + (w - dw) / 2) * s, (y + (w - dh) / 2) * s, dw * s, dh * s);
  }
}

// ---------- colour checks ----------

export function parseHex(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

const luminance = ([r, g, b]) => {
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

// WCAG contrast ratio, 1–21.
export function contrastRatio(a, b) {
  const la = luminance(parseHex(a)), lb = luminance(parseHex(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const isInverted = (fg, bg) => luminance(parseHex(fg)) > luminance(parseHex(bg));
