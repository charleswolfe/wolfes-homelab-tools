import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  detectKind, unquote, parseSpf, checkSpf, parseDmarc, parseDkim, rsaKeyBits, dmarcParents, externalReportChecks, verdict,
} from '../site/lib/email-auth.js';

const levels = (r, level) => r.findings.filter((f) => f.level === level).map((f) => f.text);

test('detects record kinds, quoted or not', () => {
  assert.equal(detectKind('v=spf1 -all'), 'spf');
  assert.equal(detectKind('"v=spf1 mx ~all"'), 'spf');
  assert.equal(detectKind('v=DMARC1; p=none'), 'dmarc');
  assert.equal(detectKind('v=DKIM1; k=rsa; p=MIIB'), 'dkim');
  assert.equal(detectKind('k=rsa; p=' + 'A'.repeat(60)), 'dkim');
  assert.equal(detectKind('google-site-verification=abc'), null);
  assert.equal(unquote('"v=spf1 include:a.example " "-all"'), 'v=spf1 include:a.example -all');
  assert.equal(unquote('v=spf1 -all'), 'v=spf1 -all');
});

test('SPF: terms, lookups and explanations', () => {
  const r = parseSpf('v=spf1 ip4:192.0.2.0/24 ip6:2001:db8::/32 a mx:mail.example.com/24 include:_spf.google.com exists:%{i}._spf.example.com -all', 'example.com');
  assert.equal(r.valid, true);
  assert.equal(r.lookups, 4);
  assert.deepEqual(r.terms.map((t) => [t.name, t.qualifier, t.lookups]), [
    ['ip4', '+', 0], ['ip6', '+', 0], ['a', '+', 1], ['mx', '+', 1], ['include', '+', 1], ['exists', '+', 1], ['all', '-', 0],
  ]);
  assert.equal(r.terms[3].target, 'mail.example.com');
  assert.equal(r.terms[3].cidr4, 24);
  assert.match(r.terms[2].explain, /^Allowed: The IP addresses of example\.com/);
  assert.match(r.terms[5].explain, /macros/);
  assert.match(r.terms[6].explain, /reject/);
  assert.deepEqual(levels(r, 'ok').length, 1);
});

test('SPF: problems receivers care about', () => {
  assert.match(levels(parseSpf('v=spf1 +all'), 'error')[0], /every server/);
  assert.match(levels(parseSpf('v=spf1 mx'), 'warn')[0], /No “all”/);
  assert.match(levels(parseSpf('v=spf1 ?all'), 'warn')[0], /neutral/);
  assert.match(levels(parseSpf('v=spf1 -all include:x.example'), 'warn')[0], /after “-all” is ignored/);
  assert.match(levels(parseSpf('v=spf1 ptr ~all'), 'warn')[0], /deprecated/);
  assert.match(levels(parseSpf('v=spf1 redirect=a.example -all'), 'warn')[0], /redirect=” is ignored/);
  assert.equal(parseSpf('v=spf1 redirect=a.example -all').lookups, 0);
  assert.match(levels(parseSpf('v=spf1 ip4:10.0.0.0/4 -all'), 'warn')[0], /huge range/);
  for (const [rec, re] of [
    ['v=spf1 ip4:300.1.1.1 -all', /out of range/],
    ['v=spf1 ip4:10.0.0.0/33 -all', /0–32/],
    ['v=spf1 include -all', /needs a domain/],
    ['v=spf1 inculde:a.example -all', /isn’t an SPF mechanism/],
    ['v=spf1 redirect=a.example redirect=b.example', /more than once/],
    ['v=spf1 a:/24 -all', /no domain/],
    ['v=spf1 mx//129 -all', /128/],
    ['v=spf2 -all', /must start with “v=spf1”/],
    ['v=spf1 include:_spf.example.com\u00a0-all', /printable ASCII/],
  ]) {
    const r = parseSpf(rec);
    assert.equal(r.valid, false, rec);
    assert.match(levels(r, 'error').join(' '), re, rec);
  }
  const many = parseSpf(`v=spf1 ${Array.from({ length: 11 }, (_, i) => `include:s${i}.example`).join(' ')} -all`);
  assert.equal(many.lookups, 11);
  assert.match(levels(many, 'error')[0], /limit is 10/);
});

// A fake DNS for checkSpf: name → TXT strings (missing names are NXDOMAIN).
const zone = (records, mx = {}) => ({
  getTxt: async (n) => (n in records ? { rcode: 0, texts: records[n] } : { rcode: 3, texts: [] }),
  getMx: async (n) => ({ rcode: 0, hosts: mx[n] ?? [] }),
});

test('SPF: follows includes and counts every lookup', async () => {
  const r = await checkSpf('example.com', zone({
    'example.com': ['v=spf1 mx include:a.example include:b.example -all', 'google-site-verification=x'],
    'a.example': ['v=spf1 ip4:192.0.2.0/24 include:c.example ~all'],
    'b.example': ['v=spf1 a ip6:2001:db8::/48 ~all'],
    'c.example': ['v=spf1 ip4:198.51.100.7 -all'],
  }, { 'example.com': ['mx1.example.com.'] }));
  assert.equal(r.lookups, 5); // mx, include a, include c, include b, a
  assert.equal(r.voids, 0);
  assert.deepEqual(r.ips.map((i) => `${i.value} ${i.from}`), ['192.0.2.0/24 a.example', '198.51.100.7 c.example', '2001:db8::/48 b.example']);
  assert.equal(r.root.children.length, 2);
  assert.equal(r.root.children[0].children[0].domain, 'c.example');
  assert.deepEqual(r.findings, []);
});

test('SPF: over the limit, missing includes, duplicates and loops', async () => {
  const records = { 'example.com': [`v=spf1 ${Array.from({ length: 6 }, (_, i) => `include:i${i}.example`).join(' ')} -all`] };
  for (let i = 0; i < 6; i++) records[`i${i}.example`] = ['v=spf1 a mx -all'];
  const mx = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`i${i}.example`, [`mx.i${i}.example.`]]));
  const over = await checkSpf('example.com', zone(records, mx));
  assert.equal(over.lookups, 18);
  assert.match(over.findings[0].text, /18 DNS lookups in total/);
  assert.equal(over.voids, 0);

  const missing = await checkSpf('example.com', zone({ 'example.com': ['v=spf1 include:gone.example include:nospf.example -all'], 'nospf.example': ['hello'] }));
  assert.equal(missing.voids, 2);
  assert.equal(missing.findings.filter((f) => /makes the whole record fail/.test(f.text)).length, 2);

  const two = await checkSpf('example.com', zone({ 'example.com': ['v=spf1 -all', 'v=spf1 mx -all'] }));
  assert.match(two.findings[0].text, /2 SPF records/);

  const loop = await checkSpf('example.com', zone({ 'example.com': ['v=spf1 include:a.example -all'], 'a.example': ['v=spf1 include:example.com -all'] }));
  assert.match(loop.root.children[0].children[0].error, /already included/);

  const none = await checkSpf('example.com', zone({ 'example.com': ['v=DMARC1; p=none'] }));
  assert.equal(none.root.record, null);
  assert.match(none.findings[0].text, /no SPF record/);
});

test('DMARC: tags, policy summary and advice', () => {
  const r = parseDmarc('v=DMARC1; p=quarantine; sp=reject; pct=50; rua=mailto:d@example.com,mailto:x@reports.example!10m; adkim=s');
  assert.equal(r.valid, true);
  assert.equal(r.policy, 'quarantine');
  assert.equal(r.summary, 'Mail that fails DMARC is sent to spam or quarantine (50% of it; the rest is treated one step softer). For subdomains: rejected.');
  assert.deepEqual(r.tags.find((t) => t.name === 'rua').uris.map((u) => u.domain), ['example.com', 'reports.example']);
  assert.match(levels(r, 'warn')[0], /only 50%/);

  assert.match(levels(parseDmarc('v=DMARC1; p=none; rua=mailto:a@example.com'), 'warn')[0], /only monitors/);
  assert.match(levels(parseDmarc('v=DMARC1; p=reject'), 'warn')[0], /No rua=/);
  assert.equal(levels(parseDmarc('v=DMARC1; p=reject; rua=mailto:a@example.com'), 'ok').length, 1);
  assert.match(levels(parseDmarc('v=DMARC1; rua=mailto:a@example.com'), 'warn')[0], /treat the record as p=none/);
  assert.equal(parseDmarc('v=DMARC1; rua=mailto:a@example.com').policy, 'none');
  for (const [rec, re] of [
    ['v=DMARC1; p=block', /none, quarantine or reject/],
    ['v=DMARC1', /p= \(policy\) tag is required/],
    ['p=reject; v=DMARC1', /must start with “v=DMARC1;”/],
    ['v=dmarc1; p=reject', /exactly “v=DMARC1”/],
    ['v=DMARC1; p=reject; pct=150', /0 to 100/],
    ['v=DMARC1; p=reject; rua=dmarc@example.com', /mailto:/],
    ['v=DMARC1; p=reject; p=none', /more than once/],
    ['v=DMARC1; p=reject; adkim=x', /relaxed/],
  ]) {
    const p = parseDmarc(rec);
    assert.equal(p.valid, false, rec);
    assert.match(levels(p, 'error').join(' '), re, rec);
  }
  assert.match(levels(parseDmarc('v=DMARC1; p=reject; rua=mailto:a@example.com; foo=bar'), 'warn')[0], /Unknown tag/);
});

test('DMARC: parent domains and external report authorisation', () => {
  assert.deepEqual(dmarcParents('a.b.example.com'), ['b.example.com', 'example.com']);
  assert.deepEqual(dmarcParents('example.com'), []);
  const p = parseDmarc('v=DMARC1; p=reject; rua=mailto:a@example.com,mailto:b@mail.example.com,mailto:c@vendor.net; ruf=mailto:d@vendor.net');
  assert.deepEqual(externalReportChecks('example.com', p), [{ domain: 'vendor.net', name: 'example.com._report._dmarc.vendor.net' }]);
});

test('DKIM: RSA key sizes from SPKI and PKCS#1, revoked keys, flags', () => {
  const spki = (bits) => generateKeyPairSync('rsa', { modulusLength: bits }).publicKey.export({ type: 'spki', format: 'der' });
  const k2048 = spki(2048);
  assert.equal(rsaKeyBits(new Uint8Array(k2048)), 2048);
  const pkcs1 = generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ type: 'pkcs1', format: 'der' });
  assert.equal(rsaKeyBits(new Uint8Array(pkcs1)), 1024);
  assert.equal(rsaKeyBits(new Uint8Array([1, 2, 3])), null);

  const good = parseDkim(`v=DKIM1; k=rsa; p=${k2048.toString('base64').replace(/(.{60})/g, '$1 ')}`);
  assert.equal(good.keyBits, 2048);
  assert.equal(verdict(good.findings), 'ok');
  const weak = parseDkim(`v=DKIM1; k=rsa; p=${Buffer.from(pkcs1).toString('base64')}; t=y; h=sha1`);
  assert.equal(weak.keyBits, 1024);
  assert.equal(verdict(weak.findings), 'warn');
  assert.equal(weak.findings.length, 3);
  const small = parseDkim(`p=${spki(512).toString('base64')}`);
  assert.equal(small.valid, false);
  assert.match(small.findings[0].text, /512-bit/);
  const ed = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  assert.equal(parseDkim(`v=DKIM1; k=ed25519; p=${Buffer.from(ed).toString('base64')}`).keyBits, 256);

  assert.equal(parseDkim('v=DKIM1; p=').revoked, true);
  assert.match(parseDkim('v=DKIM1; k=rsa').findings[0].text, /p= \(public key\) tag is required/);
  assert.match(parseDkim('v=DKIM1; p=not*base64').findings[0].text, /base64/);
  assert.match(parseDkim('k=rsa; v=DKIM1; p=').findings[0].text, /first tag/);
});
