import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeQr, addEccAndInterleave, formatBits, maxCapacity, numDataCodewords, QrTooLongError } from '../site/lib/qr.js';
import * as C from '../site/lib/qr-content.js';

const hex = (a) => a.map((b) => b.toString(16).padStart(2, '0')).join(' ');

test('Reed–Solomon matches the ISO/IEC 18004 worked example ("01234567", 1-M)', () => {
  const data = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
  const out = addEccAndInterleave(data, 1, 'M');
  assert.equal(hex(out.slice(16)), 'a5 24 d4 c1 ed 36 c7 87 2c 55');
});

test('format information bits', () => {
  assert.equal(formatBits('M', 0), 0b101010000010010);
  assert.equal(formatBits('L', 0), 0b111011111000100);
  assert.equal(formatBits('H', 7), 0b000100000111011);
});

test('capacities match the standard tables', () => {
  assert.equal(numDataCodewords(1, 'L'), 19);
  assert.equal(numDataCodewords(1, 'H'), 9);
  assert.equal(numDataCodewords(10, 'M'), 216);
  assert.equal(numDataCodewords(40, 'L'), 2956);
  assert.equal(maxCapacity('L', 'byte'), 2953);
  assert.equal(maxCapacity('M', 'byte'), 2331);
  assert.equal(maxCapacity('Q', 'byte'), 1663);
  assert.equal(maxCapacity('H', 'byte'), 1273);
  assert.equal(maxCapacity('L', 'numeric'), 7089);
  assert.equal(maxCapacity('L', 'alphanumeric'), 4296);
});

test('version selection, modes and ECC boosting', () => {
  const n = encodeQr('01234567', { ecc: 'M', boostEcc: false });
  assert.deepEqual([n.version, n.mode, n.ecc, n.size], [1, 'numeric', 'M', 21]);
  assert.equal(encodeQr('HELLO WORLD', { ecc: 'Q' }).mode, 'alphanumeric');
  assert.equal(encodeQr('hello', { ecc: 'L' }).mode, 'byte');
  assert.equal(encodeQr('x'.repeat(17), { ecc: 'L', boostEcc: false }).version, 1);
  assert.equal(encodeQr('x'.repeat(18), { ecc: 'L', boostEcc: false }).version, 2);
  const boosted = encodeQr('hi', { ecc: 'L' });
  assert.equal(boosted.ecc, 'H');
  assert.equal(boosted.requestedEcc, 'L');
  assert.throws(() => encodeQr('x'.repeat(1274), { ecc: 'H' }), QrTooLongError);
  assert.equal(encodeQr('x'.repeat(1273), { ecc: 'H' }).version, 40);
});

test('matrix structure: finder patterns, timing, dark module', () => {
  const qr = encodeQr('https://example.com', { ecc: 'M' });
  const s = qr.size;
  for (const [ox, oy] of [[0, 0], [s - 7, 0], [0, s - 7]]) {
    for (let i = 0; i < 7; i++) {
      assert.ok(qr.isDark(ox + i, oy) && qr.isDark(ox + i, oy + 6), 'finder border');
    }
    assert.ok(!qr.isDark(ox + 1, oy + 1) && qr.isDark(ox + 3, oy + 3), 'finder ring/center');
  }
  for (let i = 8; i < s - 8; i++) assert.equal(qr.isDark(i, 6), i % 2 === 0, 'timing');
  assert.ok(qr.isDark(8, s - 8), 'dark module');
});

// ---------- payload builders ----------

test('url adds https:// and validates', () => {
  assert.equal(C.url({ url: 'example.com/a?b=1' }).text, 'https://example.com/a?b=1');
  assert.equal(C.url({ url: 'ftp://nas.lan' }).text, 'ftp://nas.lan');
  assert.throws(() => C.url({ url: '' }), /required/);
});

test('wifi escapes special characters', () => {
  assert.equal(C.wifi({ ssid: 'Home;Net', password: 'p@ss:w0rd"', auth: 'WPA' }).text, 'WIFI:T:WPA;S:Home\\;Net;P:p@ss\\:w0rd\\";;');
  assert.equal(C.wifi({ ssid: 'Guest', auth: 'nopass', hidden: true }).text, 'WIFI:T:nopass;S:Guest;H:true;;');
  assert.throws(() => C.wifi({ ssid: 'x', password: 'short', auth: 'WPA' }), /at least 8/);
});

test('vCard and MeCard', () => {
  const v = C.vcard({ first: 'Ada', last: 'Lovelace', org: 'Analytical, Inc.', phone: '+1 555 0100', email: 'ada@example.com', city: 'London' });
  assert.equal(v.text.split('\r\n')[2], 'N:Lovelace;Ada;;;');
  assert.ok(v.text.includes('ORG:Analytical\\, Inc.'));
  assert.ok(v.text.includes('ADR;TYPE=WORK:;;;London;;;'));
  assert.ok(v.text.endsWith('END:VCARD'));
  assert.equal(C.mecard({ first: 'Ada', last: 'Lovelace', phone: '555', email: 'a@b.c' }).text, 'MECARD:N:Lovelace,Ada;TEL:555;EMAIL:a@b.c;;');
});

test('email, sms, phone, geo', () => {
  assert.equal(C.email({ to: 'ops@home.arpa', subject: 'Disk full', body: 'Hi & bye' }).text, 'mailto:ops@home.arpa?subject=Disk%20full&body=Hi%20%26%20bye');
  assert.equal(C.sms({ phone: '+1 (555) 010-0', message: 'hello' }).text, 'SMSTO:+15550100:hello');
  assert.equal(C.phone({ phone: '+44 20 7946 0000' }).text, 'tel:+442079460000');
  assert.equal(C.geo({ lat: '51.5', lng: '-0.12', label: 'Big Ben' }).text, 'geo:51.5,-0.12?q=51.5,-0.12(Big%20Ben)');
  assert.throws(() => C.geo({ lat: '91', lng: '0' }), /Latitude/);
});

test('calendar event (timed and all-day)', () => {
  const e = C.event({ title: 'Patch night; servers', start: '2026-11-03T20:00', end: '2026-11-03T22:00' });
  const lines = e.text.split('\r\n');
  assert.equal(lines[1], 'SUMMARY:Patch night\\; servers');
  assert.match(lines[2], /^DTSTART:\d{8}T\d{6}Z$/);
  assert.match(lines[3], /^DTEND:\d{8}T\d{6}Z$/);
  const all = C.event({ title: 'Holiday', start: '2026-12-31', allDay: true });
  assert.ok(all.text.includes('DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101'));
  assert.throws(() => C.event({ title: 'x', start: '2026-11-03T22:00', end: '2026-11-03T20:00' }), /after start/);
});

test('crypto payment URIs', () => {
  assert.equal(C.crypto({ coin: 'bitcoin', address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', amount: '0.001', label: 'Lab fund' }).text,
    'bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.001&label=Lab%20fund');
  assert.equal(C.crypto({ coin: 'ethereum', address: '0x' + 'a'.repeat(40), amount: '1' }).text, 'ethereum:0x' + 'a'.repeat(40));
  assert.throws(() => C.crypto({ coin: 'bitcoin', address: 'nope' }), /Bitcoin address/);
  assert.throws(() => C.crypto({ coin: 'bitcoin', address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT', amount: '1.123456789' }), /8 decimal/);
});
