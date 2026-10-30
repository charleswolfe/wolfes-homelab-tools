import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeQuery, decodeMessage, base64url, dohUrl, normalizeName, reverseName, parseEndpoint, typeNumber, typeName,
  answerKey, formatTtl, digText,
} from '../site/lib/dns.js';

// Real Cloudflare DoH responses (2026-10-30), with the EDNS padding removed.
const FIXTURES = {
  // example.com A, DNSSEC requested: two A records plus an RRSIG, AD set.
  a: 'AACBoAABAAMAAAABB2V4YW1wbGUDY29tAAABAAHADAABAAEAAAEHAASsQpPzwAwAAQABAAABBwAEaBQXmsAMAC4AAQAAAQcAXwABDQIAAAEsauX24GrjN8CGyQdleGFtcGxlA2NvbQA4xjUWZvdQTN9oN4PL49OTeIlsIbvfRy1eqD8V537Y2wo3Kzu51o0Y1RVp/4lmIl6SNBXZNgytGAKy7njzOObpAAApBNAAAIAAAAA=',
  // cloudflare.com HTTPS (SVCB parameters).
  https: 'AACBoAABAAEAAAABCmNsb3VkZmxhcmUDY29tAABBAAHADABBAAEAAADsAD0AAQAAAQAGAmgzAmgyAAQACGgQhOVoEIXlAAYAICYGRwAAAAAAAAAAAGgQhOUmBkcAAAAAAAAAAABoEIXlAAApBNAAAAAAAAA=',
  // dnssec-failed.org A: SERVFAIL with an Extended DNS Error.
  fail: 'AACBggABAAAAAAABDWRuc3NlYy1mYWlsZWQDb3JnAAABAAEAACkE0AAAAAAAOQAPADUACW5vIFNFUCBtYXRjaGluZyB0aGUgRFMgZm91bmQgZm9yIGRuc3NlYy1mYWlsZWQub3JnLg==',
  // gmail.com MX: heavy name compression.
  mx: 'AACBgAABAAUAAAABBWdtYWlsA2NvbQAADwABwAwADwABAAAL7QAgAAoEYWx0MQ1nbWFpbC1zbXRwLWluAWwGZ29vZ2xlwBLADAAPAAEAAAvtAAkAHgRhbHQzwC7ADAAPAAEAAAvtAAQABcAuwAwADwABAAAL7QAJABQEYWx0MsAuwAwADwABAAAL7QAJACgEYWx0NMAuAAApBNAAAAAAAAA=',
};
const fixture = (k) => decodeMessage(new Uint8Array(Buffer.from(FIXTURES[k], 'base64')));

test('query messages: header, question, EDNS and padding', () => {
  const q = encodeQuery('example.com', 'MX');
  assert.equal(q.length % 128, 0, 'padded to a 128-byte block');
  assert.deepEqual([...q.subarray(0, 12)], [0, 0, 0x01, 0x20, 0, 1, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual([...q.subarray(12, 29)], [7, ...Buffer.from('example'), 3, ...Buffer.from('com'), 0, 0, 15, 0, 1]);
  assert.deepEqual([...q.subarray(29, 38)], [0, 0, 41, 0x04, 0xd0, 0, 0, 0, 0], 'OPT with a 1232-byte UDP size, DO clear');
  // The padding option fills the rest of the message.
  assert.deepEqual([...q.subarray(40, 42)], [0, 12]);
  assert.equal((q[42] << 8 | q[43]) + 44, q.length);

  const d = encodeQuery('example.com.', 'A', { dnssec: true, cd: true, pad: false });
  assert.equal(d.length, 40);
  assert.equal(d[3] & 0x10, 0x10, 'CD bit');
  assert.equal(d[36], 0x80, 'DO bit');

  // Decodes back to the same question.
  assert.deepEqual(decodeMessage(encodeQuery('_sip._tcp.example.com', 'SRV')).question, [{ name: '_sip._tcp.example.com.', type: 'SRV', class: 1 }]);
  assert.deepEqual(decodeMessage(encodeQuery('.', 'NS')).question[0].name, '.');
});

test('DoH GET URLs use unpadded base64url', () => {
  assert.equal(base64url(new Uint8Array([0xfb, 0xff, 0xfe])), '-__-');
  assert.equal(base64url(new Uint8Array([1])), 'AQ');
  const u = new URL(dohUrl('https://dns.example/dns-query?x=1', encodeQuery('example.com', 'A', { pad: false })));
  assert.equal(u.searchParams.get('x'), '1');
  assert.match(u.searchParams.get('dns'), /^[A-Za-z0-9_-]+$/);
});

test('names: trailing dots, IDN, limits', () => {
  assert.equal(normalizeName('Example.COM.'), 'Example.COM');
  assert.equal(normalizeName('bücher.de'), 'xn--bcher-kva.de');
  assert.equal(normalizeName('.'), '');
  assert.throws(() => normalizeName(''), /Enter a domain/);
  assert.throws(() => normalizeName('a..b'), /empty label/);
  assert.throws(() => normalizeName('x'.repeat(64) + '.com'), /limit is 63/);
  assert.throws(() => normalizeName(Array(64).fill('abcd').join('.')), /limit is 253/);
  assert.throws(() => normalizeName('bad name.ü'), /spaces/);
});

test('reverse names for IPv4 and IPv6 addresses', () => {
  assert.equal(reverseName('192.0.2.1'), '1.2.0.192.in-addr.arpa');
  assert.equal(reverseName('2001:db8::567:89ab'), 'b.a.9.8.7.6.5.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa');
  assert.equal(reverseName('example.com'), null);
  assert.equal(reverseName('1.2.3'), null);
});

test('decodes A records, RRSIG and the DNSSEC flags', () => {
  const m = fixture('a');
  assert.equal(m.rcodeName, 'NOERROR');
  assert.ok(m.flags.qr && m.flags.rd && m.flags.ra && m.flags.ad);
  assert.equal(m.edns.do, true);
  assert.deepEqual(m.answer.map((r) => [r.name, r.type, r.ttl, r.data]).slice(0, 2), [
    ['example.com.', 'A', 263, '172.66.147.243'],
    ['example.com.', 'A', 263, '104.20.23.154'],
  ]);
  const sig = m.answer[2];
  assert.equal(sig.type, 'RRSIG');
  assert.match(sig.data, /^A 13 2 300 \d{14} \d{14} 34505 example\.com\. [A-Za-z0-9+/]+=*$/);
  assert.equal(sig.fields.signer, 'example.com.');
});

test('decodes HTTPS service parameters', () => {
  const [rr] = fixture('https').answer;
  assert.equal(rr.data, '1 . alpn=h3,h2 ipv4hint=104.16.132.229,104.16.133.229 ipv6hint=2606:4700::6810:84e5,2606:4700::6810:85e5');
});

test('decodes compressed MX names', () => {
  const m = fixture('mx');
  assert.equal(m.answer.length, 5);
  assert.deepEqual(m.answer.map((r) => r.data).sort(), [
    '10 alt1.gmail-smtp-in.l.google.com.', '20 alt2.gmail-smtp-in.l.google.com.', '30 alt3.gmail-smtp-in.l.google.com.',
    '40 alt4.gmail-smtp-in.l.google.com.', '5 gmail-smtp-in.l.google.com.',
  ]);
  assert.equal(m.answer[2].fields.preference, 5);
});

test('SERVFAIL with an Extended DNS Error', () => {
  const m = fixture('fail');
  assert.equal(m.rcodeName, 'SERVFAIL');
  assert.deepEqual(m.edns.errors, [{ code: 9, name: 'DNSKEY missing', text: 'no SEP matching the DS found for dnssec-failed.org.' }]);
  assert.match(digText(m), /status: SERVFAIL/);
  assert.match(digText(m), /; EDE: 9 \(DNSKEY missing\)/);
});

// A response with one answer of the given type and RDATA, for synthetic cases.
function response(type, rdata, { rcode = 0 } = {}) {
  const head = [0, 0, 0x81, 0x80 | rcode, 0, 1, 0, 1, 0, 0, 0, 0];
  const q = [1, 120, 0, type >> 8, type & 255, 0, 1];
  const rr = [0xc0, 12, type >> 8, type & 255, 0, 1, 0, 0, 0x0e, 0x10, rdata.length >> 8, rdata.length & 255, ...rdata];
  return new Uint8Array([...head, ...q, ...rr]);
}

test('TXT, CAA, SOA and unknown types', () => {
  const txt = decodeMessage(response(16, [7, ...Buffer.from('v=spf1 '), 4, ...Buffer.from('-all'), 3, 0x22, 0x5c, 0xff])).answer[0];
  assert.equal(txt.data, '"v=spf1 " "-all" "\\"\\\\\\255"');
  assert.equal(txt.fields.text.slice(0, 11), 'v=spf1 -all');
  const caa = decodeMessage(response(257, [0, 5, ...Buffer.from('issue'), ...Buffer.from('letsencrypt.org')])).answer[0];
  assert.equal(caa.data, '0 issue "letsencrypt.org"');
  const soa = decodeMessage(response(6, [2, 110, 115, 0xc0, 12, 1, 104, 0xc0, 12, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0, 5])).answer[0];
  assert.equal(soa.data, 'ns.x. h.x. 1 2 3 4 5');
  const unknown = decodeMessage(response(65280, [0xde, 0xad])).answer[0];
  assert.equal(unknown.type, 'TYPE65280');
  assert.equal(unknown.data, '\\# 2 DEAD');
  // An A record with the wrong length falls back to the generic form.
  assert.equal(decodeMessage(response(1, [1, 2, 3])).answer[0].data, '\\# 3 010203');
  assert.equal(decodeMessage(response(1, [], { rcode: 3 })).rcodeName, 'NXDOMAIN');
});

test('malformed responses throw instead of looping', () => {
  assert.throws(() => decodeMessage(new Uint8Array(5)), /too short/);
  const full = response(1, [192, 0, 2, 1]);
  assert.throws(() => decodeMessage(full.subarray(0, full.length - 2)), /truncated|malformed/);
  // A compression pointer that points at itself.
  const loop = new Uint8Array([0, 0, 0x81, 0x80, 0, 1, 0, 0, 0, 0, 0, 0, 0xc0, 12, 0, 1, 0, 1]);
  assert.throws(() => decodeMessage(loop), /malformed/);
});

test('helpers: types, TTLs, endpoints, answer comparison', () => {
  assert.equal(typeNumber('aaaa'), 28);
  assert.equal(typeNumber('TYPE65280'), 65280);
  assert.throws(() => typeNumber('nope'), /Unknown record type/);
  assert.equal(typeName(257), 'CAA');
  assert.equal(formatTtl(0), '0s');
  assert.equal(formatTtl(3600), '1h');
  assert.equal(formatTtl(90061), '1d 1h 1m 1s');
  assert.equal(parseEndpoint(' https://dns.home.lan/dns-query#x '), 'https://dns.home.lan/dns-query');
  assert.throws(() => parseEndpoint('dns.home.lan'), /full DoH URL/);
  assert.throws(() => parseEndpoint('ftp://dns.home.lan/'), /https:\/\//);
  assert.throws(() => parseEndpoint('https://u:p@dns.home.lan/'), /passwords/);
  // Same records in a different order with other TTLs count as the same answer.
  const a = fixture('a');
  const b = { ...a, answer: [...a.answer].reverse().map((r) => ({ ...r, ttl: 1 })) };
  assert.equal(answerKey(a), answerKey(b));
  assert.equal(answerKey(fixture('fail')), 'SERVFAIL');
});
