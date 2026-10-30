// The only network code on the site outside the vendored VIA app
// (DNS_FETCH_FILE in scripts/security.mjs). Sends one DNS-over-HTTPS GET to
// the resolver the user chose, without cookies or a referrer. It stays a
// CORS "simple" request (GET, Accept only): extra headers, including the
// Cache-Control that cache: 'no-store' adds, trigger a preflight that Google
// rejects. Browser caching follows the answer's TTL (RFC 8484 §5.1).
import { encodeQuery, dohUrl, decodeMessage } from '/lib/dns.js';

const TIMEOUT_MS = 8000;

export class LookupError extends Error {}

export async function resolve(endpoint, name, type, { dnssec = false, cd = false, signal } = {}) {
  const url = dohUrl(new URL(endpoint, location.href).href, encodeQuery(name, type, { dnssec, cd }));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
  const start = performance.now();
  let res;
  try {
    res = await fetch(url, {
      headers: { accept: 'application/dns-message' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      signal: ctrl.signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    if (ctrl.signal.aborted) throw new LookupError(`No answer within ${TIMEOUT_MS / 1000} seconds.`);
    if (location.protocol === 'https:' && endpoint.startsWith('http:')) {
      throw new LookupError('This page is on HTTPS, so the browser blocks a resolver on plain http://.');
    }
    throw new LookupError('The browser couldn’t reach the resolver, or the resolver doesn’t allow requests from web pages (it sends no CORS header).');
  } finally {
    clearTimeout(timer);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const ms = performance.now() - start;
  if (!res.ok) throw new LookupError(`The resolver answered HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}.`);
  if (!/application\/dns-message/i.test(res.headers.get('content-type') || '')) {
    throw new LookupError('That URL didn’t return a DNS answer. Check it’s the resolver’s DoH endpoint (often ending in /dns-query).');
  }
  return { msg: decodeMessage(bytes), ms, size: bytes.length };
}
