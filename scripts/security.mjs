// Single source of truth for the site's security policy. The same CSP is
// embedded as a <meta> tag in every page (test/offline.test.js checks they
// match) and sent as a response header by the container.

// Same-origin only: the site must work offline and never contact another host.
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

// frame-ancestors is ignored in <meta>, so it only goes in the header.
const CSP_HEADER = `${CSP}; frame-ancestors 'self'`;

export const COMMON_HEADERS = {
  'Content-Security-Policy': CSP_HEADER,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  // hid is deliberately left at its default (self) for the VIA tool.
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=()',
  // File names aren't content-hashed, so always revalidate (cheap 304s on a
  // LAN) rather than risk new HTML running against stale JS.
  'Cache-Control': 'no-cache',
};

// The favicon is the one file other sites may embed, and only sibling
// subdomains of the same site (a dashboard at home.example.com showing
// tools.example.com's icon). Everything else stays same-origin.
export const FAVICON_PATH = 'favicon.svg';
export const FAVICON_CORP = 'same-site';

// static-web-server forces "max-age=63072000; includeSubDomains; preload"
// whenever TLS is on. We always override it: a year without preload when HSTS
// is opted into, otherwise max-age=0, which tells browsers not to pin HTTPS.
export const HSTS_ON = 'max-age=31536000';
export const HSTS_OFF = 'max-age=0';

// Stricter policy for pages that handle secrets (the Bitcoin paper wallet,
// the password generator):
// no network access at all, not even to this server, and no workers/frames.
// Browsers enforce both this <meta> policy and the server header, so the
// stricter directive wins.
export const STRICT_CSP = CSP
  .replace("connect-src 'self'", "connect-src 'none'")
  .replace("worker-src 'self'", "worker-src 'none'")
  .replace("frame-src 'self'", "frame-src 'none'");

// Pages that must use STRICT_CSP (paths relative to site/).
export const STRICT_PAGES = ['bitcoin-wallet/index.html', 'password/index.html'];

// The DNS pages are the one exception to "never contact another host": DNS
// Lookup and the SPF & DMARC Checker send DNS-over-HTTPS queries, when the
// user clicks the button, to public resolvers or one the user enters. Only connect-src opens up; scripts,
// styles, fonts and images still load from this server alone. http: is for
// a resolver on the LAN when the site itself is served over plain HTTP.
export const DNS_CSP = CSP.replace("connect-src 'self'", "connect-src 'self' https: http:");
export const DNS_PAGES = ['dns/index.html', 'spf-dmarc/index.html'];
// The only file allowed to call fetch() outside the vendored VIA app; both
// DNS pages import it.
export const DNS_FETCH_FILE = 'dns/resolve.js';

// The vendored VIA app (site/via/app/). Still same-origin only, with the
// relaxations it can't run without:
//   - 'unsafe-eval': its definition validator (ajv, inside @the-via/reader)
//     compiles JSON schemas with new Function();
//   - 'unsafe-inline' styles: styled-components injects <style> tags;
//   - 'wasm-unsafe-eval' + blob: workers: the Draco decoder for the 3D
//     keyboard model is WebAssembly running in a blob: worker.
// These only matter if an attacker can inject script; the page loads nothing
// but this server's own files, and no other host is reachable.
export const VIA_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
export const VIA_PATH = 'via/app/';
