// UUID generation (v4, v7) and inspection, per RFC 9562.
// Uses crypto.getRandomValues, which unlike crypto.randomUUID also works in
// insecure (plain-HTTP) contexts.

export const NIL = '00000000-0000-0000-0000-000000000000';
export const MAX = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

function bytesToUuid(b) {
  let h = '';
  for (const x of b) h += x.toString(16).padStart(2, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function uuidv4() {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return bytesToUuid(b);
}

// v7: 48-bit Unix ms timestamp + 74 random bits. Within one millisecond the
// 12-bit rand_a field is used as a counter (RFC 9562 §6.2 method 1) so a
// batch generated in a tight loop still sorts in creation order.
let lastMs = -1;
let seq = 0;

export function uuidv7(now = Date.now()) {
  if (now > lastMs) {
    lastMs = now;
    seq = randomBytes(2)[0] << 3; // random start in the lower half leaves room to count
  } else {
    seq++;
    if (seq > 0xfff) {
      lastMs++;
      seq = 0;
    }
  }
  const ms = lastMs;
  const b = randomBytes(16);
  b[0] = Math.floor(ms / 2 ** 40) & 0xff;
  b[1] = Math.floor(ms / 2 ** 32) & 0xff;
  b[2] = (ms >>> 24) & 0xff;
  b[3] = (ms >>> 16) & 0xff;
  b[4] = (ms >>> 8) & 0xff;
  b[5] = ms & 0xff;
  b[6] = 0x70 | (seq >>> 8);
  b[7] = seq & 0xff;
  b[8] = (b[8] & 0x3f) | 0x80;
  return bytesToUuid(b);
}

export function formatUuid(uuid, { upper = false, hyphens = true, braces = false } = {}) {
  let s = hyphens ? uuid : uuid.replace(/-/g, '');
  if (upper) s = s.toUpperCase();
  return braces ? `{${s}}` : s;
}

// 100-ns intervals between the Gregorian epoch (1582-10-15) and Unix epoch.
const GREGORIAN_OFFSET = 0x01b21dd213814000n;

export function parseUuid(input) {
  const raw = input.trim().replace(/^urn:uuid:/i, '').replace(/^\{(.*)\}$/, '$1');
  const hex = raw.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex) || !/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(raw)) {
    throw new Error('Not a UUID. Expected 32 hex digits, optionally as 8-4-4-4-12 with hyphens.');
  }
  const lower = hex.toLowerCase();
  const canonical = `${lower.slice(0, 8)}-${lower.slice(8, 12)}-${lower.slice(12, 16)}-${lower.slice(16, 20)}-${lower.slice(20)}`;
  if (canonical === NIL) return { canonical, version: null, variant: 'Nil UUID', special: 'nil' };
  if (canonical === MAX) return { canonical, version: null, variant: 'Max UUID', special: 'max' };

  const v8 = parseInt(lower[16], 16);
  const variant = v8 < 8 ? 'NCS (reserved)' : v8 < 12 ? 'RFC 9562' : v8 < 14 ? 'Microsoft (reserved)' : 'Future (reserved)';
  const version = parseInt(lower[12], 16);
  const result = { canonical, version, variant, versionName: VERSION_NAMES[version] || 'Unknown' };

  if (variant === 'RFC 9562') {
    if (version === 7) {
      result.timestamp = new Date(parseInt(lower.slice(0, 12), 16));
    } else if (version === 1 || version === 6) {
      const ticks = version === 1
        ? (BigInt('0x' + lower.slice(13, 16)) << 48n) | (BigInt('0x' + lower.slice(8, 12)) << 32n) | BigInt('0x' + lower.slice(0, 8))
        : (BigInt('0x' + lower.slice(0, 12)) << 12n) | BigInt('0x' + lower.slice(13, 16));
      result.timestamp = new Date(Number((ticks - GREGORIAN_OFFSET) / 10000n));
      result.node = lower.slice(20).match(/../g).join(':');
    }
  }
  return result;
}

const VERSION_NAMES = {
  1: 'Time-based (Gregorian, MAC)',
  2: 'DCE Security',
  3: 'Name-based (MD5)',
  4: 'Random',
  5: 'Name-based (SHA-1)',
  6: 'Time-based (reordered)',
  7: 'Time-ordered (Unix ms)',
  8: 'Custom',
};
