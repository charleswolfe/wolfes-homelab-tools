// Pixel Art Maker helpers that don't touch the DOM: the BMP encoder, line and
// brush rasterising, and palettes.

// 24-bit uncompressed BMP (BITMAPINFOHEADER, BI_RGB): rows bottom-up, pixels
// as B, G, R, each row padded to a multiple of 4 bytes. `rgba` is canvas
// ImageData order; alpha is blended onto `background` since 24-bit BMP has
// no transparency.
export function encodeBMP(width, height, rgba, background = [255, 255, 255]) {
  if (!(width > 0 && height > 0)) throw new RangeError('BMP width and height must be positive.');
  if (rgba.length !== width * height * 4) throw new RangeError('Pixel data doesn’t match the image size.');
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const fileSize = 54 + pixelBytes;
  const out = new Uint8Array(fileSize);
  const dv = new DataView(out.buffer);
  out[0] = 0x42; // 'B'
  out[1] = 0x4d; // 'M'
  dv.setUint32(2, fileSize, true);
  dv.setUint32(10, 54, true);          // pixel data offset
  dv.setUint32(14, 40, true);          // BITMAPINFOHEADER size
  dv.setInt32(18, width, true);
  dv.setInt32(22, height, true);       // positive = bottom-up
  dv.setUint16(26, 1, true);           // planes
  dv.setUint16(28, 24, true);          // bits per pixel
  dv.setUint32(30, 0, true);           // BI_RGB
  dv.setUint32(34, pixelBytes, true);
  dv.setInt32(38, 2835, true);         // 72 DPI, in pixels per metre
  dv.setInt32(42, 2835, true);
  const [br, bg, bb] = background;
  for (let y = 0; y < height; y++) {
    let o = 54 + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = rgba[i + 3] / 255;
      out[o++] = Math.round(rgba[i + 2] * a + bb * (1 - a));
      out[o++] = Math.round(rgba[i + 1] * a + bg * (1 - a));
      out[o++] = Math.round(rgba[i] * a + br * (1 - a));
    }
  }
  return out;
}

// Every pixel on the line from (x0, y0) to (x1, y1), ends included
// (Bresenham), so fast pointer moves still draw an unbroken stroke.
export function linePoints(x0, y0, x1, y1) {
  const pts = [];
  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    pts.push([x0, y0]);
    if (x0 === x1 && y0 === y1) return pts;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// Snaps the end point to the nearest 45° direction from the start (Shift).
export function snapEnd(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.max(Math.abs(dx), Math.abs(dy));
  const cos = Math.round(Math.cos(angle));
  const sin = Math.round(Math.sin(angle));
  return [x0 + cos * len, y0 + sin * len];
}

// Square brush of `size` px centred on (x, y): its top-left offset.
export const brushOffset = (size) => 0 - Math.floor((size - 1) / 2);

export const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const rgbToHex = ([r, g, b]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

// The 16-colour palette of Windows' Paint (and VGA).
export const PALETTE_16 = [
  '#000000', '#808080', '#800000', '#808000', '#008000', '#008080', '#000080', '#800080',
  '#ffffff', '#c0c0c0', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff',
];

export const MAX_SIDE = 1024;
