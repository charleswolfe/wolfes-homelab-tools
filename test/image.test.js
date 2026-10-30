import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sniffFormat, svgSize, targetSize, downscaleSteps, outputName, sizeChange, crc32, makeZip } from '../site/lib/image.js';

const bytes = (...parts) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));
const pad = (b) => { const out = new Uint8Array(32); out.set(b); return out; };

test('sniffs image formats from magic bytes', () => {
  assert.equal(sniffFormat(pad(bytes([0x89], 'PNG\r\n\x1a\n'))), 'PNG');
  assert.equal(sniffFormat(pad(bytes([0xff, 0xd8, 0xff, 0xe0]))), 'JPEG');
  assert.equal(sniffFormat(pad(bytes('GIF89a'))), 'GIF');
  assert.equal(sniffFormat(pad(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '))), 'WebP');
  assert.equal(sniffFormat(pad(bytes('BM'))), 'BMP');
  assert.equal(sniffFormat(pad(bytes([0, 0, 1, 0, 1, 0]))), 'ICO');
  assert.equal(sniffFormat(pad(bytes('II*\0'))), 'TIFF');
  assert.equal(sniffFormat(pad(bytes([0, 0, 0, 0x1c], 'ftypavif'))), 'AVIF');
  assert.equal(sniffFormat(pad(bytes([0, 0, 0, 0x18], 'ftypheic'))), 'HEIC');
  assert.equal(sniffFormat(new TextEncoder().encode('  <?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>')), 'SVG');
  assert.equal(sniffFormat(new TextEncoder().encode('hello world')), null);
  assert.equal(sniffFormat(new Uint8Array(0)), null);
});

test('svg natural size from width/height or viewBox', () => {
  assert.deepEqual(svgSize('<svg width="64" height="32"/>'), { width: 64, height: 32 });
  assert.deepEqual(svgSize('<svg width="300px" viewBox="0 0 30 10"/>'), { width: 300, height: 100 });
  assert.deepEqual(svgSize('<svg viewBox="0 0 10 20"/>'), { width: 512, height: 1024 });
  assert.deepEqual(svgSize('<svg viewBox="0,0,40,10"/>'), { width: 1024, height: 256 });
  assert.deepEqual(svgSize('<svg width="100%" height="100%" viewBox="0 0 1 1"/>'), { width: 1024, height: 1024 });
  assert.deepEqual(svgSize('<svg xmlns="http://www.w3.org/2000/svg"/>'), { width: 1024, height: 1024 });
  assert.equal(svgSize('<html></html>'), null);
});

test('target size for each resize mode', () => {
  assert.deepEqual(targetSize(4000, 3000), { width: 4000, height: 3000 });
  assert.deepEqual(targetSize(4000, 3000, { mode: 'scale', scale: 25 }), { width: 1000, height: 750 });
  assert.deepEqual(targetSize(4000, 3000, { mode: 'fit', maxWidth: 1920, maxHeight: 1080 }), { width: 1440, height: 1080 });
  assert.deepEqual(targetSize(4000, 3000, { mode: 'fit', maxWidth: 800 }), { width: 800, height: 600 });
  assert.deepEqual(targetSize(400, 300, { mode: 'fit', maxWidth: 800 }), { width: 400, height: 300 }); // no enlarging
  assert.deepEqual(targetSize(400, 300, { mode: 'fit', maxWidth: 800, enlarge: true }), { width: 800, height: 600 });
  assert.deepEqual(targetSize(400, 300, { mode: 'fit' }), { width: 400, height: 300 });
  assert.deepEqual(targetSize(3, 1000, { mode: 'scale', scale: 1 }), { width: 1, height: 10 });
});

test('downscale goes by halves, then the exact size', () => {
  assert.deepEqual(downscaleSteps(4000, 3000, 900, 675), [{ width: 2000, height: 1500 }, { width: 1000, height: 750 }, { width: 900, height: 675 }]);
  assert.deepEqual(downscaleSteps(1000, 800, 800, 640), [{ width: 800, height: 640 }]);
  assert.deepEqual(downscaleSteps(100, 100, 200, 200), [{ width: 200, height: 200 }]);
});

test('output names swap the extension and never collide', () => {
  const taken = new Set();
  assert.equal(outputName('IMG_0001.HEIC', 'jpg', taken), 'IMG_0001.jpg');
  assert.equal(outputName('IMG_0001.png', 'jpg', taken), 'IMG_0001-2.jpg');
  assert.equal(outputName('img_0001.webp', 'jpg', taken), 'img_0001-3.jpg');
  assert.equal(outputName('archive.tar.png', 'webp'), 'archive.tar.webp');
  assert.equal(outputName('noext', 'png'), 'noext.png');
  assert.equal(outputName('.png', 'png'), 'image.png');
  assert.equal(outputName('a:b?.png', 'png'), 'a_b_.png');
});

test('size change wording', () => {
  assert.equal(sizeChange(1000, 250), '75% smaller');
  assert.equal(sizeChange(1000, 1500), '50% larger');
  assert.equal(sizeChange(1000, 1001), 'same size');
  assert.equal(sizeChange(1000, 2500), '2.5× larger');
  assert.equal(sizeChange(107, 13000), '121× larger');
});

test('crc32 check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('zip archive is valid (checked with unzip when available)', (t) => {
  const enc = new TextEncoder();
  const zip = makeZip([
    { name: 'photo.webp', data: enc.encode('fake webp bytes') },
    { name: 'café.png', data: new Uint8Array([1, 2, 3, 255]) },
  ], new Date(2026, 9, 29, 12, 30, 10));
  const dv = new DataView(zip.buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  assert.equal(dv.getUint32(zip.length - 22, true), 0x06054b50);
  assert.equal(dv.getUint16(zip.length - 12, true), 2);
  let hasUnzip = true;
  try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); } catch { hasUnzip = false; }
  if (!hasUnzip) return t.skip('unzip not installed');
  const dir = mkdtempSync(join(tmpdir(), 'hlt-zip-'));
  try {
    const file = join(dir, 'test.zip');
    writeFileSync(file, zip);
    const out = execFileSync('unzip', ['-t', file], { encoding: 'utf8' });
    assert.match(out, /No errors detected/);
    assert.equal(execFileSync('unzip', ['-p', file, 'photo.webp'], { encoding: 'utf8' }), 'fake webp bytes');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
