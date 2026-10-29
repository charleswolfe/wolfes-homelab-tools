import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bytesToBase64, base64ToBytes, encodeText, decodeToText, utf8OrNull } from '../site/lib/base64.js';

// RFC 4648 §10 test vectors
const vectors = [
  ['', ''], ['f', 'Zg=='], ['fo', 'Zm8='], ['foo', 'Zm9v'],
  ['foob', 'Zm9vYg=='], ['fooba', 'Zm9vYmE='], ['foobar', 'Zm9vYmFy'],
];

test('RFC 4648 vectors round-trip', () => {
  for (const [plain, b64] of vectors) {
    assert.equal(encodeText(plain), b64);
    assert.equal(decodeToText(b64), plain);
  }
});

test('UTF-8 text', () => {
  const s = 'héllo wörld ✓ 🐺';
  assert.equal(decodeToText(encodeText(s)), s);
  assert.equal(encodeText('✓'), '4pyT');
});

test('URL-safe alphabet and padding options', () => {
  const bytes = new Uint8Array([0xfb, 0xff, 0xbf]);
  assert.equal(bytesToBase64(bytes), '+/+/');
  assert.equal(bytesToBase64(bytes, { urlSafe: true }), '-_-_');
  assert.equal(encodeText('f', { pad: false }), 'Zg');
  assert.deepEqual(base64ToBytes('-_-_'), bytes);
});

test('decoder is lenient about whitespace, missing padding and data URIs', () => {
  assert.equal(decodeToText('Zm9v\nYmE'), 'fooba');
  assert.equal(decodeToText('  Zg  '), 'f');
  assert.equal(decodeToText('data:text/plain;base64,Zm9vYmFy'), 'foobar');
});

test('decoder rejects malformed input with useful messages', () => {
  assert.throws(() => base64ToBytes('Zm9v*'), /Invalid character “\*” at position 5/);
  assert.throws(() => base64ToBytes('Zm=9v'), /only appear at the end/);
  assert.throws(() => base64ToBytes('Zm9vY'), /Invalid length/);
  assert.throws(() => base64ToBytes('Zg==='), /Too much padding/);
  assert.throws(() => base64ToBytes('a+b-'), /Mixes standard/);
});

test('binary payloads are detected', () => {
  const bin = new Uint8Array([0xff, 0xfe, 0x00, 0x80]);
  assert.equal(utf8OrNull(base64ToBytes(bytesToBase64(bin))), null);
  assert.throws(() => decodeToText(bytesToBase64(bin)), /binary/);
});

test('large inputs encode without stack overflow', () => {
  const big = new Uint8Array(500_000).map((_, i) => i & 0xff);
  assert.deepEqual(base64ToBytes(bytesToBase64(big)), big);
});
