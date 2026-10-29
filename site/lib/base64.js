// Base64 encode/decode for bytes and UTF-8 text. Pure functions, no DOM:
// runs in browsers and in Node (tests).

const CHUNK = 0x8000;

export function bytesToBase64(bytes, { urlSafe = false, pad = true } = {}) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  let out = btoa(binary);
  if (urlSafe) out = out.replace(/\+/g, '-').replace(/\//g, '_');
  if (!pad) out = out.replace(/=+$/, '');
  return out;
}

// Accepts standard or URL-safe alphabets, missing padding, embedded
// whitespace/newlines and an optional `data:...;base64,` prefix.
export function base64ToBytes(input) {
  let s = String(input).replace(/\s+/g, '');
  const dataUri = /^data:[^,]*;base64,/i.exec(s);
  if (dataUri) s = s.slice(dataUri[0].length);
  if (!s) return new Uint8Array(0);

  const bad = /[^A-Za-z0-9+/\-_=]/.exec(s);
  if (bad) {
    throw new Error(`Invalid character “${bad[0]}” at position ${bad.index + 1}.`);
  }
  if (/[-_]/.test(s) && /[+/]/.test(s)) {
    throw new Error('Mixes standard (+ /) and URL-safe (- _) alphabets.');
  }
  s = s.replace(/-/g, '+').replace(/_/g, '/');

  const body = s.replace(/=+$/, '');
  if (body.includes('=')) throw new Error('Padding “=” may only appear at the end.');
  if (s.length - body.length > 2) throw new Error('Too much padding: at most two “=” are allowed.');
  if (body.length % 4 === 1) throw new Error('Invalid length: input is truncated or has an extra character.');

  const padded = body + '='.repeat((4 - (body.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export const encodeText = (text, options) => bytesToBase64(new TextEncoder().encode(text), options);

// Returns the decoded string, or null when the bytes are not valid UTF-8
// (i.e. the payload is binary).
export function utf8OrNull(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function decodeToText(input) {
  const text = utf8OrNull(base64ToBytes(input));
  if (text === null) throw new Error('Decoded data is binary, not UTF-8 text.');
  return text;
}
