import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeBMP, linePoints, snapEnd, brushOffset, hexToRgb, rgbToHex, PALETTE_16 } from '../site/lib/bmp.js';

// 3×2 image: row 0 red, green, blue; row 1 white, black, half-transparent black.
const W = 3;
const H = 2;
const px = new Uint8ClampedArray([
  255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
  255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 128,
]);

test('BMP header fields', () => {
  const b = encodeBMP(W, H, px);
  const dv = new DataView(b.buffer);
  assert.equal(String.fromCharCode(b[0], b[1]), 'BM');
  const rowSize = 12; // 9 bytes of pixels padded to a multiple of 4
  assert.equal(dv.getUint32(2, true), 54 + rowSize * H);
  assert.equal(b.length, 54 + rowSize * H);
  assert.equal(dv.getUint32(10, true), 54);
  assert.equal(dv.getUint32(14, true), 40);
  assert.equal(dv.getInt32(18, true), W);
  assert.equal(dv.getInt32(22, true), H);
  assert.equal(dv.getUint16(26, true), 1);
  assert.equal(dv.getUint16(28, true), 24);
  assert.equal(dv.getUint32(30, true), 0);
  assert.equal(dv.getUint32(34, true), rowSize * H);
});

test('BMP pixels are bottom-up BGR with padded rows and alpha blended onto the background', () => {
  const b = encodeBMP(W, H, px, [255, 255, 255]);
  const row = (y) => [...b.subarray(54 + y * 12, 54 + y * 12 + 12)];
  // First stored row is the image's bottom row.
  assert.deepEqual(row(0), [255, 255, 255, 0, 0, 0, 127, 127, 127, 0, 0, 0]);
  assert.deepEqual(row(1), [0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0, 0]);
  // A different background changes only the blended pixel.
  const onRed = encodeBMP(W, H, px, [255, 0, 0]);
  assert.deepEqual([...onRed.subarray(60, 63)], [0, 0, 127]);
});

test('BMP rejects bad sizes', () => {
  assert.throws(() => encodeBMP(0, 1, new Uint8ClampedArray(0)), RangeError);
  assert.throws(() => encodeBMP(2, 2, new Uint8ClampedArray(4)), /doesn’t match/);
});

test('lines include both ends and have no gaps', () => {
  assert.deepEqual(linePoints(0, 0, 3, 0), [[0, 0], [1, 0], [2, 0], [3, 0]]);
  assert.deepEqual(linePoints(2, 2, 2, 2), [[2, 2]]);
  assert.deepEqual(linePoints(0, 0, 2, 2), [[0, 0], [1, 1], [2, 2]]);
  for (const [x0, y0, x1, y1] of [[0, 0, 17, 5], [10, 3, -4, 9], [5, 5, 6, -20]]) {
    const pts = linePoints(x0, y0, x1, y1);
    assert.deepEqual(pts[0], [x0, y0]);
    assert.deepEqual(pts.at(-1), [x1, y1]);
    for (let i = 1; i < pts.length; i++) {
      assert.ok(Math.abs(pts[i][0] - pts[i - 1][0]) <= 1 && Math.abs(pts[i][1] - pts[i - 1][1]) <= 1, 'gap in line');
    }
  }
});

test('shift-snapping to 45° directions', () => {
  assert.deepEqual(snapEnd(0, 0, 10, 2), [10, 0]);
  assert.deepEqual(snapEnd(0, 0, 9, 8), [9, 9]);
  assert.deepEqual(snapEnd(5, 5, 4, -10), [5, -10]);
  assert.deepEqual(snapEnd(0, 0, -7, 6), [-7, 7]);
});

test('brush offsets centre odd sizes and lean up-left for even ones', () => {
  assert.equal(brushOffset(1), 0);
  assert.equal(brushOffset(2), 0);
  assert.equal(brushOffset(3), -1);
  assert.equal(brushOffset(8), -3);
});

test('colour helpers and palette', () => {
  assert.deepEqual(hexToRgb('#1f6f5c'), [31, 111, 92]);
  assert.equal(hexToRgb('nope'), null);
  assert.equal(rgbToHex([31, 111, 92]), '#1f6f5c');
  assert.equal(PALETTE_16.length, 16);
  assert.ok(PALETTE_16.every((c) => hexToRgb(c)));
});
