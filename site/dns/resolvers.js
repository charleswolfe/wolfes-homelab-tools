// DoH resolvers offered by the DNS Lookup and SPF & DMARC Checker pages.
// The public ones answer browser (CORS) requests over both HTTP/2 and
// HTTP/3; checked 2026-10-30. Quad9 is left out: its HTTP/3 responses lack
// Access-Control-Allow-Origin, so it fails once the browser has switched.
export const RESOLVERS = [
  { id: 'cloudflare', name: 'Cloudflare', url: 'https://cloudflare-dns.com/dns-query' },
  { id: 'google', name: 'Google', url: 'https://dns.google/dns-query' },
  { id: 'controld', name: 'Control D', url: 'https://freedns.controld.com/p0' },
  { id: 'self', name: 'This server, /dns-query', url: '/dns-query' },
  { id: 'custom', name: 'Custom DoH URL…', url: null },
];
export const PUBLIC = RESOLVERS.slice(0, 3);
