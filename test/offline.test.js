// Guards the "no outside connections, no trackers" rule for everything under
// site/, including vendored third-party code. Any file copied into the repo
// must pass this before it can ship.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { CSP, STRICT_CSP, STRICT_PAGES, VIA_CSP, VIA_PATH } from '../scripts/security.mjs';

const ROOT = new URL('../site/', import.meta.url).pathname;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(ROOT).filter((f) => ['.html', '.js', '.mjs', '.css', '.svg', '.json', '.webmanifest'].includes(extname(f)));
const rel = (f) => relative(ROOT, f);

// Strip comments so URLs in license headers / docs don't count. Line comments
// are only removed when `//` isn't part of a scheme like "https://".
const stripJsComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/[^\n]*/g, '$1');

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:)?\/\/|^(?:https?|ftp|wss?):/i;

const TRACKERS = [
  /google-analytics\.com/i, /googletagmanager\.com/i, /\bgtag\s*\(/, /\bga\s*\(\s*['"](?:send|create)/,
  /analytics\.js\b/i, /\bsegment\.(?:io|com)\b/i, /\bmixpanel\b/i, /\bsentry\b/i, /\bhotjar\b/i,
  /plausible\.io/i, /\bmatomo\b|\bpiwik\b/i, /\bamplitude\b/i, /\bposthog\b/i, /clarity\.ms/i,
  /doubleclick\.net/i, /connect\.facebook\.net|\bfbq\s*\(/i, /\bnewrelic\b|\bnr-data\b/i, /datadoghq|\bdd_rum\b/i,
  /\bbugsnag\b/i, /\blogrocket\b/i, /\bfullstory\b/i, /\bheap(?:analytics)?\.io\b/i, /\bintercom\b/i,
  /cloudflareinsights|beacon\.min\.js/i, /\bumami\b/i, /\bsplitbee\b/i, /\bfathom\b/i,
];

// The vendored VIA app (built by scripts/via/build.sh) legitimately uses
// fetch() for its own keyboard definitions and Web Workers for its Draco
// decoder, so instead of banning those APIs there we require every absolute
// URL in its code to be one of these known non-request strings.
const isVia = (f) => rel(f).startsWith(VIA_PATH);
const isViaDefinitions = (f) => rel(f).startsWith(`${VIA_PATH}definitions/`); // keyboard data, not code
const VIA_URL_ALLOWLIST = {
  'http://www.w3.org': 'XML/SVG namespace identifiers',
  'http://json-schema.org': 'JSON Schema $schema identifiers (ajv)',
  'https://raw.githubusercontent.com': 'ajv $data meta-schema $ref identifier, never fetched',
  'https://www.gstatic.com': 'drei default Draco decoder path, overridden by our patch (and blocked by CSP)',
  'https://github.com': 'text inside library error messages',
  'https://reactjs.org': 'text inside React error messages',
  'https://redux.js.org': 'text inside Redux error messages',
  'https://redux-toolkit.js.org': 'text inside Redux Toolkit error messages',
  'https://docs.pmnd.rs': 'text inside react-three-fiber error messages',
  'https://bit.ly': 'text inside Immer error messages',
  'http://fb.me': 'text inside prop-types error messages',
};

const NETWORK_APIS = [
  /\bfetch\s*\(/, /\bnew\s+XMLHttpRequest\b/, /\bsendBeacon\s*\(/, /\bnew\s+WebSocket\b/, /\bnew\s+EventSource\b/,
  /\bimportScripts\s*\(/, /\bnew\s+RTCPeerConnection\b/,
];

test('every HTML page declares a same-origin-only Content-Security-Policy', () => {
  for (const f of files.filter((x) => x.endsWith('.html'))) {
    const html = readFileSync(f, 'utf8');
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1];
    assert.ok(csp, `${rel(f)} has no CSP meta tag`);
    const expected = isVia(f) ? VIA_CSP : STRICT_PAGES.includes(rel(f)) ? STRICT_CSP : CSP;
    assert.equal(csp, expected, `${rel(f)} CSP differs from scripts/security.mjs`);
    const required = ["default-src 'self'", "script-src 'self'", "style-src 'self'", "font-src 'self'",
      expected === STRICT_CSP ? "connect-src 'none'" : "connect-src 'self'"];
    if (expected === VIA_CSP) required.splice(1, 3, "script-src 'self' ", "style-src 'self' ", "font-src 'self' ");
    for (const d of required) {
      assert.ok(csp.includes(d), `${rel(f)} CSP is missing ${d}`);
    }
    assert.ok(!/https?:|\*/.test(csp), `${rel(f)} CSP allows an external origin or wildcard`);
  }
});

test('no HTML attribute points at another origin', () => {
  for (const f of files.filter((x) => x.endsWith('.html') || x.endsWith('.svg'))) {
    const html = readFileSync(f, 'utf8');
    for (const m of html.matchAll(/\s(src|href|action|srcset|poster|data|xlink:href|formaction|ping)\s*=\s*["']([^"']*)["']/gi)) {
      assert.ok(!EXTERNAL.test(m[2].trim()), `${rel(f)}: ${m[1]}="${m[2]}" loads from outside`);
    }
  }
});

test('no CSS loads remote fonts, images or stylesheets', () => {
  for (const f of files.filter((x) => x.endsWith('.css') || x.endsWith('.html'))) {
    const css = readFileSync(f, 'utf8');
    for (const m of css.matchAll(/(?:url\(\s*["']?|@import\s+["'])([^"')]+)/gi)) {
      assert.ok(!EXTERNAL.test(m[1].trim()), `${rel(f)}: references ${m[1]}`);
    }
  }
});

test('no JavaScript makes network requests or imports remote modules', () => {
  for (const f of files.filter((x) => /\.m?js$/.test(x))) {
    const code = stripJsComments(readFileSync(f, 'utf8'));
    if (!isVia(f)) for (const re of NETWORK_APIS) assert.ok(!re.test(code), `${rel(f)} uses ${re}`);
    for (const m of code.matchAll(/(?:\bimport\s*(?:[\w*{}\s,]+from\s*)?|\bimport\s*\(\s*|new\s+(?:Worker|SharedWorker)\s*\(\s*)["'`]([^"'`]+)["'`]/g)) {
      assert.ok(!EXTERNAL.test(m[1]), `${rel(f)} imports ${m[1]}`);
    }
  }
});

test('vendored VIA app only contains allow-listed (non-request) URLs', () => {
  const viaFiles = files.filter((f) => isVia(f) && !isViaDefinitions(f) && /\.(m?js|css|html|json|webmanifest)$/.test(f));
  assert.ok(viaFiles.some((f) => f.endsWith('.js')), 'VIA bundle not found; run scripts/via/build.sh');
  const seen = new Set();
  for (const f of viaFiles) {
    // Explicit http(s):// URLs, or protocol-relative //host right after a quote
    // or "(" (so regex literals like /^https?:\/\//i.test don't count).
    for (const m of readFileSync(f, 'utf8').matchAll(/https?:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+|(?<=["'`(])\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi)) {
      const origin = m[0].startsWith('//') ? `https:${m[0]}` : m[0];
      seen.add(origin);
      assert.ok(VIA_URL_ALLOWLIST[origin], `${rel(f)} references ${origin}; audit it and add it to VIA_URL_ALLOWLIST with a reason, or patch it out`);
    }
  }
  assert.ok(seen.size > 0);
});

test('no known tracker or analytics code anywhere (including vendored libraries)', () => {
  for (const f of files.filter((x) => !isViaDefinitions(x))) {
    let text = readFileSync(f, 'utf8');
    if (/\.m?js$/.test(f)) text = stripJsComments(text);
    for (const re of TRACKERS) assert.ok(!re.test(text), `${rel(f)} matches tracker signature ${re}`);
  }
});

test('site/license.txt (linked from the footer) matches LICENSE', () => {
  const root = new URL('..', import.meta.url);
  assert.equal(readFileSync(new URL('site/license.txt', root), 'utf8'), readFileSync(new URL('LICENSE', root), 'utf8'),
    'copy LICENSE to site/license.txt after editing it');
});
