// URL percent-encoding and parsing.

export const ENCODE_MODES = [
  { id: 'component', label: 'Component', hint: 'encodeURIComponent: for a single query value or path segment.' },
  { id: 'rfc3986', label: 'RFC 3986', hint: 'Component encoding that also escapes ! \' ( ) *.' },
  { id: 'uri', label: 'Full URL', hint: 'encodeURI: keeps : / ? # & = intact so the URL still works.' },
  { id: 'form', label: 'Form', hint: 'application/x-www-form-urlencoded: spaces become +.' },
];

export function encode(text, mode = 'component') {
  try {
    switch (mode) {
      case 'uri': return encodeURI(text);
      case 'rfc3986': return encodeURIComponent(text).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
      case 'form': return new URLSearchParams({ x: text }).toString().slice(2);
      default: return encodeURIComponent(text);
    }
  } catch {
    throw new Error('Input contains an unpaired surrogate character and cannot be encoded as UTF-8.');
  }
}

export function decode(text, { plusAsSpace = false } = {}) {
  const s = plusAsSpace ? text.replace(/\+/g, ' ') : text;
  try {
    return decodeURIComponent(s);
  } catch {
    // Pinpoint the problem for the error message.
    const bad = /%(?![0-9a-f]{2})/i.exec(s);
    if (bad) {
      throw new Error(`Malformed escape “${s.slice(bad.index, bad.index + 3)}” at position ${bad.index + 1}: % must be followed by two hex digits.`);
    }
    for (const m of s.matchAll(/(?:%[0-9a-f]{2})+/gi)) {
      try {
        decodeURIComponent(m[0]);
      } catch {
        throw new Error(`Invalid UTF-8 byte sequence “${m[0]}” at position ${m.index + 1}.`);
      }
    }
    throw new Error('Input could not be decoded.');
  }
}

// Breaks an absolute URL into parts; returns null for anything that isn't one.
export function parseUrl(text) {
  const s = text.trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s) || /[\r\n]/.test(s)) return null;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  return {
    href: u.href,
    protocol: u.protocol,
    username: u.username,
    password: u.password,
    hostname: u.hostname,
    port: u.port,
    pathname: u.pathname,
    search: u.search,
    hash: u.hash,
    origin: u.origin === 'null' ? '' : u.origin,
    params: [...u.searchParams.entries()],
  };
}
