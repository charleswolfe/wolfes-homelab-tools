// Single source of truth for every tool. The index, navigation, search
// palette and sitemap are all generated from this file.
// Keep it free of DOM access so Node build scripts can import it.

export const SITE = {
  name: 'Homelab Tools',
  tagline: 'Small, sharp utilities for everyday dev and homelab work.',
};

export const categories = [
  {
    id: 'generate',
    name: 'Generate',
    short: 'Generate',
    icon: 'sparkle',
    blurb: 'Create codes, identifiers and checksums.',
  },
  {
    id: 'convert',
    name: 'Convert',
    short: 'Convert',
    icon: 'arrows',
    blurb: 'Translate data between encodings and formats.',
  },
  {
    id: 'inspect',
    name: 'Inspect & Validate',
    short: 'Inspect',
    icon: 'inspect',
    blurb: 'Check, format and pick apart structured data.',
  },
  {
    id: 'hardware',
    name: 'Hardware & Crypto',
    short: 'Hardware',
    icon: 'chip',
    blurb: 'Keyboards and cold-storage key generation.',
  },
];

// `ready: false` tools are listed as "Soon" and are not linked.
// `https.level` is 'required' (won't work over plain HTTP) or 'recommended';
// the shell shows a notice when such a page is opened without HTTPS.
export const tools = [
  {
    id: 'qr', path: '/qr/', category: 'generate', icon: 'qr', ready: true,
    name: 'QR Code Generator',
    summary: 'URLs, Wi-Fi, vCards and more, with custom colors and a center logo.',
    keywords: ['qr', 'barcode', 'wifi', 'vcard', 'logo', 'url', 'sms', 'email'],
  },
  {
    id: 'uuid', path: '/uuid/', category: 'generate', icon: 'id', ready: true,
    name: 'UUID Generator',
    summary: 'Random v4 and time-ordered v7 UUIDs, one or in bulk.',
    keywords: ['uuid', 'guid', 'v4', 'v7', 'random', 'id'],
  },
  {
    id: 'hash', path: '/hash/', category: 'generate', icon: 'hash', ready: true,
    name: 'Hash Generator',
    summary: 'SHA-256, SHA-384, SHA-512 and MD5 for text or files.',
    keywords: ['hash', 'sha', 'sha256', 'sha512', 'md5', 'checksum', 'digest'],
  },
  {
    id: 'base64', path: '/base64/', category: 'convert', icon: 'binary', ready: true,
    name: 'Base64',
    summary: 'Encode and decode text or files, standard or URL-safe.',
    keywords: ['base64', 'b64', 'encode', 'decode', 'data uri', 'binary'],
  },
  {
    id: 'url', path: '/url/', category: 'convert', icon: 'link', ready: true,
    name: 'URL Encode / Decode',
    summary: 'Percent-encode components or full URLs, and decode them back.',
    keywords: ['url', 'uri', 'percent', 'encode', 'decode', 'escape', 'query'],
  },
  {
    id: 'case', path: '/case/', category: 'convert', icon: 'case', ready: true,
    name: 'Case Converter',
    summary: 'Slugify, camelCase, snake_case, kebab-case, Title Case and more.',
    keywords: ['case', 'slug', 'slugify', 'camel', 'snake', 'kebab', 'pascal', 'title'],
  },
  {
    id: 'json-yaml', path: '/json-yaml/', category: 'convert', icon: 'swap', ready: true,
    name: 'JSON ↔ YAML',
    summary: 'Convert between JSON and YAML in either direction.',
    keywords: ['json', 'yaml', 'yml', 'convert'],
  },
  {
    id: 'timestamp', path: '/timestamp/', category: 'convert', icon: 'clock', ready: true,
    name: 'Timestamp Converter',
    summary: 'Unix seconds and milliseconds to ISO 8601 and local time, and back.',
    keywords: ['timestamp', 'unix', 'epoch', 'date', 'time', 'iso', '8601'],
  },
  {
    id: 'json', path: '/json/', category: 'inspect', icon: 'braces', ready: true,
    name: 'JSON Formatter',
    summary: 'Validate, pretty-print and minify JSON with exact error locations.',
    keywords: ['json', 'lint', 'validate', 'format', 'pretty', 'minify', 'beautify'],
  },
  {
    id: 'jwt', path: '/jwt/', category: 'inspect', icon: 'key', ready: true,
    name: 'JWT Decoder',
    summary: 'Read a token’s header, claims and expiry without sending it anywhere.',
    keywords: ['jwt', 'token', 'jws', 'bearer', 'claims', 'decode'],
  },
  {
    id: 'regex', path: '/regex/', category: 'inspect', icon: 'regex', ready: true,
    name: 'Regex Tester',
    summary: 'Live matches, capture groups and replace preview.',
    keywords: ['regex', 'regexp', 'regular expression', 'match', 'replace', 'pattern'],
  },
  {
    id: 'bitcoin-wallet', path: '/bitcoin-wallet/', category: 'hardware', icon: 'wallet', ready: true,
    name: 'Bitcoin Paper Wallet',
    summary: 'Printable key pairs generated offline: Legacy, SegWit and Taproot.',
    keywords: ['bitcoin', 'btc', 'wallet', 'paper', 'cold storage', 'private key', 'address'],
    https: {
      level: 'recommended',
      reason: 'Over plain HTTP, anyone between you and this server could alter the page before it generates your keys.',
    },
  },
  {
    id: 'via', path: '/via/', category: 'hardware', icon: 'keyboard', ready: true,
    name: 'VIA Keyboard Configurator',
    summary: 'Remap QMK keyboards in the browser over WebHID.',
    keywords: ['via', 'keyboard', 'qmk', 'keymap', 'macro', 'webhid'],
    https: {
      level: 'required',
      reason: 'VIA talks to your keyboard through WebHID, which browsers only allow on secure (HTTPS) pages.',
    },
  },
];

export const toolById = (id) => tools.find((t) => t.id === id) || null;
export const categoryById = (id) => categories.find((c) => c.id === id) || null;
export const toolsIn = (categoryId) => tools.filter((t) => t.category === categoryId);

// Every whitespace-separated term must match somewhere; results are ranked
// with name hits above keyword hits above summary hits.
export function searchTools(query, list = tools) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return list.slice();
  const scored = [];
  for (const tool of list) {
    const name = tool.name.toLowerCase();
    const summary = tool.summary.toLowerCase();
    const category = categoryById(tool.category).name.toLowerCase();
    let score = 0;
    let matchedAll = true;
    for (const term of terms) {
      let s = 0;
      if (name.startsWith(term)) s = 10;
      else if (name.includes(term)) s = 6;
      else if (tool.keywords.some((k) => k.startsWith(term))) s = 5;
      else if (tool.keywords.some((k) => k.includes(term))) s = 3;
      else if (summary.includes(term)) s = 2;
      else if (category.includes(term)) s = 1;
      if (!s) { matchedAll = false; break; }
      score += s;
    }
    if (matchedAll) scored.push({ tool, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.tool);
}
