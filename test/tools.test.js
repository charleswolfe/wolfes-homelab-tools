import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uuidv4, uuidv7, parseUuid, formatUuid, NIL } from '../site/lib/uuid.js';
import { encode, decode, parseUrl } from '../site/lib/url.js';
import { CASES, splitWords, slugify, titleCase, convertLines } from '../site/lib/case.js';
import { parseTimestamp, describe } from '../site/lib/timestamp.js';
import { parseJson, formatAst, stats, codeFrame } from '../site/lib/json.js';
import { decodeJwt, tokenStatus } from '../site/lib/jwt.js';
import { run, groupNames } from '../site/lib/regex.js';
import { yamlToJson, jsonToYaml } from '../site/lib/yaml.js';

const caseOf = (id, s) => CASES.find((c) => c.id === id).fn(s);

// ---------- UUID ----------

test('uuid v4 shape and version bits', () => {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  for (let i = 0; i < 200; i++) assert.match(uuidv4(), re);
});

test('uuid v7 encodes the timestamp and sorts in creation order', () => {
  const t = Date.UTC(2026, 9, 29, 12, 0, 0, 123);
  const u = uuidv7(t);
  assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(parseUuid(u).timestamp.getTime(), t);
  const batch = Array.from({ length: 5000 }, () => uuidv7());
  assert.deepEqual([...batch].sort(), batch);
  assert.equal(new Set(batch).size, batch.length);
});

test('uuid parse: versions, v1 timestamp, nil, formats', () => {
  // RFC 9562 Appendix A.1 example v1
  const v1 = parseUuid('C232AB00-9414-11EC-B3C8-9F6BDECED846');
  assert.equal(v1.version, 1);
  assert.equal(v1.timestamp.toISOString(), '2022-02-22T19:22:22.000Z');
  // RFC 9562 Appendix A.5 example v6 (same instant)
  assert.equal(parseUuid('1EC9414C-232A-6B00-B3C8-9F6BDECED846').timestamp.toISOString(), '2022-02-22T19:22:22.000Z');
  assert.equal(parseUuid('{' + NIL + '}').special, 'nil');
  assert.equal(parseUuid('urn:uuid:f81d4fae7dec11d0a76500a0c91e6bf6').canonical, 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6');
  assert.throws(() => parseUuid('not-a-uuid'), /Not a UUID/);
  assert.equal(formatUuid(NIL, { upper: true, hyphens: false, braces: true }), '{00000000000000000000000000000000}');
});

// ---------- URL ----------

test('url encode modes', () => {
  assert.equal(encode('a b&c/d?é', 'component'), 'a%20b%26c%2Fd%3F%C3%A9');
  assert.equal(encode("it's (ok)*", 'rfc3986'), 'it%27s%20%28ok%29%2A');
  assert.equal(encode('https://x.io/a b?q=1&r=é', 'uri'), 'https://x.io/a%20b?q=1&r=%C3%A9');
  assert.equal(encode('a b+c', 'form'), 'a+b%2Bc');
  assert.throws(() => encode('\uD800', 'component'), /unpaired surrogate/);
});

test('url decode with helpful errors', () => {
  assert.equal(decode('a%20b%C3%A9'), 'a bé');
  assert.equal(decode('a+b', { plusAsSpace: true }), 'a b');
  assert.throws(() => decode('100%'), /Malformed escape “%” at position 4/);
  assert.throws(() => decode('ok%E2%82'), /Invalid UTF-8 byte sequence “%E2%82” at position 3/);
});

test('url parse', () => {
  const p = parseUrl('https://user:pw@example.com:8443/a/b?x=1&y=two%20words#frag');
  assert.equal(p.hostname, 'example.com');
  assert.equal(p.port, '8443');
  assert.deepEqual(p.params, [['x', '1'], ['y', 'two words']]);
  assert.equal(parseUrl('just text'), null);
  assert.equal(parseUrl('/relative/path'), null);
});

// ---------- case ----------

test('case: word splitting handles acronyms, digits, separators', () => {
  assert.deepEqual(splitWords('XMLHttpRequest'), ['XML', 'Http', 'Request']);
  assert.deepEqual(splitWords('user_id-v2 final.Draft'), ['user', 'id', 'v2', 'final', 'Draft']);
  assert.deepEqual(splitWords("don't stop"), ['dont', 'stop']);
});

test('case: conversions', () => {
  const s = 'Hello world API key';
  assert.equal(caseOf('camel', s), 'helloWorldApiKey');
  assert.equal(caseOf('pascal', s), 'HelloWorldApiKey');
  assert.equal(caseOf('snake', s), 'hello_world_api_key');
  assert.equal(caseOf('constant', s), 'HELLO_WORLD_API_KEY');
  assert.equal(caseOf('kebab', 'parseHTMLString'), 'parse-html-string');
  assert.equal(caseOf('train', 'foo_bar'), 'Foo-Bar');
  assert.equal(caseOf('dot', 'fooBar'), 'foo.bar');
  assert.equal(caseOf('sentence', 'HELLO THERE. how ARE you?'), 'Hello there. How are you?');
  assert.equal(titleCase('the lord of the rings'), 'The Lord of the Rings');
});

test('case: slugify folds accents and symbols', () => {
  assert.equal(slugify('Crème Brûlée & Straße — 2026!'), 'creme-brulee-and-strasse-2026');
  assert.equal(slugify('  --Hello__World--  '), 'hello-world');
  assert.equal(slugify('A.B', { separator: '_' }), 'a_b');
  assert.equal(convertLines('foo bar\n\nbaz qux', (l) => slugify(l)), 'foo-bar\n\nbaz-qux');
});

// ---------- timestamp ----------

test('timestamp: unit auto-detection keeps full precision', () => {
  assert.equal(parseTimestamp('1700000000').unit, 's');
  assert.equal(parseTimestamp('1700000000000').unit, 'ms');
  assert.equal(parseTimestamp('1700000000000123').unit, 'us');
  const ns = parseTimestamp('1700000000123456789');
  assert.equal(ns.unit, 'ns');
  const d = describe(ns.ns, 'UTC', 0);
  assert.equal(d.nanoseconds, '1700000000123456789');
  assert.equal(d.seconds, '1700000000.123456789');
  assert.equal(d.isoUtc, '2023-11-14T22:13:20.123456789Z');
});

test('timestamp: decimals, negatives, dates, zones', () => {
  assert.equal(describe(parseTimestamp('1.5').ns, 'UTC').milliseconds, '1500');
  assert.equal(describe(parseTimestamp('-1').ns, 'UTC').isoUtc, '1969-12-31T23:59:59.000Z');
  const p = parseTimestamp('2026-10-29T14:30:00Z');
  const d = describe(p.ns, 'America/New_York', Date.parse('2026-10-29T15:30:00Z'));
  assert.equal(d.seconds, '1793284200');
  assert.equal(d.isoZoned, '2026-10-29T10:30:00.000-04:00');
  assert.equal(d.relative, '1 hour ago');
  assert.equal(d.isoWeek, '2026-W44');
  assert.equal(d.dayOfYear, 302);
  assert.equal(parseTimestamp('2026-10-29T14:30').zoneless, true);
  assert.throws(() => parseTimestamp('tomorrow-ish'), /Unrecognised date/);
  assert.throws(() => parseTimestamp('99999999999999999999999'), /Out of range/);
});

// ---------- JSON ----------

test('json: format preserves raw tokens (big ints, escapes)', () => {
  const src = '{"b":12345678901234567890,"a":"\\u00e9\\n","c":[1,{},[]]}';
  const { ast, warnings } = parseJson(src);
  assert.equal(formatAst(ast, { indent: '' }), src);
  assert.equal(formatAst(ast, { indent: '  ', sortKeys: true }),
    '{\n  "a": "\\u00e9\\n",\n  "b": 12345678901234567890,\n  "c": [\n    1,\n    {},\n    []\n  ]\n}');
  assert.match(warnings[0].message, /larger than 2\^53/);
  assert.deepEqual(stats(ast), { objects: 2, arrays: 2, keys: 3, values: 3, depth: 2 });
});

test('json: precise, friendly errors', () => {
  const err = (src) => { try { parseJson(src); } catch (e) { return e; } assert.fail('expected error'); };
  let e = err('{\n  "a": 1,\n}');
  assert.match(e.message, /Trailing comma/);
  assert.deepEqual([e.line, e.column], [2, 9]);
  assert.match(err("{'a': 1}").message, /double quotes/);
  assert.match(err('{a: 1}').message, /Property names must be in double quotes/);
  assert.match(err('[1 2]').message, /Missing comma/);
  assert.match(err('{"a": NaN}').message, /NaN is not valid/);
  assert.match(err('{"a": True}').message, /lowercase/);
  assert.match(err('// hi\n{}').message, /Comments/);
  assert.match(err('{"a": 01}').message, /leading zeros/);
  assert.match(err('"line\nbreak"').message, /\\n/);
  e = err('{"a": [1, 2');
  assert.match(e.message, /“\]” missing for the array opened at line 1, column 7/);
  assert.match(err('{} {}').message, /after the top-level value/);
  assert.match(err('').message, /empty/);
});

test('json: duplicate keys warn; code frame', () => {
  const { warnings } = parseJson('{"a":1,\n"a":2}');
  assert.match(warnings[0].message, /Duplicate key “a” \(first defined at line 1\)/);
  const f = codeFrame('a\nb\nc\nd', 4);
  assert.equal(f.line, 3);
  assert.deepEqual(f.frame.map((l) => l.n), [1, 2, 3, 4]);
});

// ---------- JWT ----------

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

test('jwt: decode, status, warnings', () => {
  const now = 1_800_000_000;
  const token = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: '42', exp: now - 10, iat: now - 3600 })}.c2ln`;
  const r = decodeJwt('Bearer ' + token);
  assert.equal(r.header.alg, 'HS256');
  assert.equal(r.payload.sub, '42');
  assert.equal(tokenStatus(r.payload, now).state, 'expired');
  assert.equal(tokenStatus({ exp: now + 10 }, now).state, 'valid');
  assert.equal(tokenStatus({ nbf: now + 10, exp: now + 20 }, now).state, 'pending');
  const unsigned = decodeJwt(`${b64url({ alg: 'none' })}.${b64url({ a: 1 })}.`);
  assert.ok(unsigned.warnings.some((w) => /unsigned/.test(w)));
  assert.ok(unsigned.warnings.some((w) => /never expires/.test(w)));
  assert.throws(() => decodeJwt('a.b'), /has 2/);
  assert.throws(() => decodeJwt('!!!.e30.x'), /Header is not valid Base64URL/);
  assert.equal(decodeJwt(`${b64url({ alg: 'RSA-OAEP', enc: 'A256GCM' })}.a.b.c.d`).kind, 'JWE');
});

// ---------- regex ----------

test('regex: matches, groups, replace, zero-width safety', () => {
  const r = run('(?<user>\\w+)@(\\w+)\\.com', 'g', 'a@b.com, cc@dd.com', { replacement: '$<user> at $2' });
  assert.equal(r.matches.length, 2);
  assert.deepEqual(r.matches[1].named, { user: 'cc' });
  assert.deepEqual(r.matches[0].groups, ['a', 'b']);
  assert.equal(r.replaced, 'a at b, cc at dd');
  assert.deepEqual(r.groupNames, ['user', null]);
  assert.deepEqual(groupNames('[(]\\((?:x)(?<a>y)(?=z)(?<!w)(q)'), ['a', null]);
  assert.equal(run('x*', 'g', 'abc').matches.length, 4); // empty matches don't loop forever
  assert.equal(run('a', '', 'aaa').matches.length, 1);
  assert.equal(run('a', 'y', 'aab').matches.length, 2);
  assert.equal(run('.', 'g', 'x'.repeat(10), { maxMatches: 3 }).truncated, true);
  assert.throws(() => run('(', 'g', ''), /Unterminated group|missing \)/i);
});

// ---------- YAML ----------

test('yaml: round trips and errors with positions', () => {
  const y = jsonToYaml('{"name":"app","ports":[80,443],"env":{"DEBUG":true},"empty":null}').output;
  assert.equal(y, 'name: app\nports:\n  - 80\n  - 443\nenv:\n  DEBUG: true\nempty: null\n');
  assert.equal(yamlToJson(y, { indent: 0 }).output, '{"name":"app","ports":[80,443],"env":{"DEBUG":true},"empty":null}');
  const multi = yamlToJson('a: 1\n---\nb: 2\n', { indent: 0 });
  assert.equal(multi.documents, 2);
  assert.equal(multi.output, '[{"a":1},{"b":2}]');
  try { yamlToJson('a: 1\n  b: 2\n'); assert.fail(); } catch (e) { assert.equal(e.line, 2); }
  try { jsonToYaml('{"a":}'); assert.fail(); } catch (e) { assert.equal(e.line, 1); assert.equal(e.column, 6); }
  assert.throws(() => yamlToJson('x: !!js/function "function(){}"'), /unknown tag/);
});

test('timestamp: relative time rounds into the larger unit', async () => {
  const { relative } = await import('../site/lib/timestamp.js');
  const now = 1_800_000_000_000;
  assert.equal(relative(now + 3_599_000, now), 'in 1 hour');
  assert.equal(relative(now - 30_000, now), '30 seconds ago');
  assert.equal(relative(now + 50 * 60_000, now), 'in 1 hour');
  assert.equal(relative(now - 3 * 86_400_000, now), '3 days ago');
  assert.equal(relative(now + 400 * 86_400_000, now), 'next year');
});

test('url parse accepts unencoded spaces', () => {
  assert.equal(parseUrl('https://nas.lan/My Files?q=a b').pathname, '/My%20Files');
});
