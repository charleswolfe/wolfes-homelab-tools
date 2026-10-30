// DNS wire format (RFC 1035) for DNS-over-HTTPS (RFC 8484): builds query
// messages and decodes responses into presentation-format records. No DOM,
// no network; the page's resolve.js does the fetch.
import { parseAddress, formatIPv4, compressIPv6 } from './subnet.js';

export const TYPES = {
  A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, HINFO: 13, MX: 15, TXT: 16, AAAA: 28, LOC: 29, SRV: 33, NAPTR: 35,
  DNAME: 39, OPT: 41, DS: 43, SSHFP: 44, RRSIG: 46, NSEC: 47, DNSKEY: 48, NSEC3: 50, NSEC3PARAM: 51, TLSA: 52,
  CDS: 59, CDNSKEY: 60, SVCB: 64, HTTPS: 65, SPF: 99, ANY: 255, CAA: 257,
};
const TYPE_NAMES = Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [v, k]));
export const typeName = (n) => TYPE_NAMES[n] ?? `TYPE${n}`;
export function typeNumber(s) {
  const t = String(s).trim().toUpperCase();
  if (TYPES[t] !== undefined) return TYPES[t];
  const m = /^TYPE(\d{1,5})$/.exec(t);
  if (m && Number(m[1]) < 65536) return Number(m[1]);
  throw new Error(`Unknown record type “${s}”.`);
}

export const RCODES = {
  0: ['NOERROR', 'The query succeeded.'],
  1: ['FORMERR', 'The resolver couldn’t parse the query.'],
  2: ['SERVFAIL', 'The resolver couldn’t get an answer. Often a DNSSEC validation failure or unreachable name servers.'],
  3: ['NXDOMAIN', 'The name doesn’t exist.'],
  4: ['NOTIMP', 'The resolver doesn’t support this kind of query.'],
  5: ['REFUSED', 'The resolver refused to answer (policy, or a blocked name).'],
  9: ['NOTAUTH', 'The server isn’t authoritative for this zone.'],
  16: ['BADVERS', 'The resolver doesn’t support this EDNS version.'],
};
export const rcodeName = (n) => RCODES[n]?.[0] ?? `RCODE${n}`;

// DNSSEC algorithm numbers (IANA), for DS / DNSKEY / RRSIG notes.
export const ALGORITHMS = {
  5: 'RSASHA1', 7: 'RSASHA1-NSEC3-SHA1', 8: 'RSASHA256', 10: 'RSASHA512', 13: 'ECDSAP256SHA256',
  14: 'ECDSAP384SHA384', 15: 'ED25519', 16: 'ED448',
};

// ---------- names ----------

// "Example.COM." or "bücher.de" → ASCII name without the trailing dot ("" is
// the root). IDNs go through the URL parser, which applies punycode (UTS 46).
export function normalizeName(raw) {
  let s = String(raw).trim();
  if (s === '.') return '';
  s = s.replace(/\.$/, '');
  if (!s) throw new Error('Enter a domain name.');
  if (/[^\x21-\x7e]/.test(s)) {
    if (/\s/.test(s)) throw new Error('A domain name can’t contain spaces.');
    try {
      s = new URL(`http://${s}/`).hostname;
    } catch {
      throw new Error(`“${raw}” isn’t a valid domain name.`);
    }
  }
  const labels = s.split('.');
  for (const l of labels) {
    if (!l) throw new Error(`“${raw}” has an empty label (two dots in a row).`);
    if (l.length > 63) throw new Error(`The label “${l.slice(0, 20)}…” is ${l.length} characters; the limit is 63.`);
  }
  if (s.length > 253) throw new Error(`The name is ${s.length} characters; the limit is 253.`);
  return s;
}

// IPv4/IPv6 address → its in-addr.arpa / ip6.arpa name, or null if `raw`
// isn't an address.
export function reverseName(raw) {
  let a;
  try {
    a = parseAddress(String(raw));
  } catch {
    return null;
  }
  if (a.version === 4) return [0n, 8n, 16n, 24n].map((s) => (a.addr >> s) & 255n).join('.') + '.in-addr.arpa';
  return Array.from({ length: 32 }, (_, i) => ((a.addr >> BigInt(4 * i)) & 15n).toString(16)).join('.') + '.ip6.arpa';
}

const encoder = new TextEncoder();

function nameBytes(name) {
  const out = [];
  if (name) {
    for (const label of name.split('.')) {
      const b = encoder.encode(label);
      out.push(b.length, ...b);
    }
  }
  out.push(0);
  return out;
}

// ---------- query ----------

const PAD_BLOCK = 128; // RFC 8467: pad queries to a multiple of 128 bytes

// Query message bytes. `dnssec` sets the DO bit (return RRSIGs); `cd` asks
// the resolver to skip validation. The ID is 0 so identical GETs can be
// cached (RFC 8484 §4.1).
export function encodeQuery(name, type, { dnssec = false, cd = false, pad = true } = {}) {
  const qtype = typeof type === 'number' ? type : typeNumber(type);
  const flags = 0x0100 /* RD */ | 0x0020 /* AD: ask for the AD bit, RFC 6840 */ | (cd ? 0x0010 : 0);
  const head = [0, 0, flags >> 8, flags & 255, 0, 1, 0, 0, 0, 0, 0, 1];
  const question = [...nameBytes(normalizeName(name || '.')), qtype >> 8, qtype & 255, 0, 1];
  // OPT pseudo-record: root name, type 41, UDP size 1232, DO flag.
  const opt = [0, 0, 41, 1232 >> 8, 1232 & 255, 0, 0, dnssec ? 0x80 : 0, 0];
  const base = head.length + question.length + opt.length + 2;
  let options = [];
  if (pad) {
    const len = (PAD_BLOCK - ((base + 4) % PAD_BLOCK)) % PAD_BLOCK;
    options = [0, 12, len >> 8, len & 255, ...new Array(len).fill(0)];
  }
  return new Uint8Array([...head, ...question, ...opt, options.length >> 8, options.length & 255, ...options]);
}

export function base64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// The GET URL for a DoH endpoint: ?dns=<base64url query>.
export function dohUrl(endpoint, query) {
  const u = new URL(endpoint);
  u.searchParams.set('dns', base64url(query));
  return u.href;
}

// "https://host/path" check for a resolver URL the user typed.
export function parseEndpoint(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    throw new Error('Enter the resolver’s full DoH URL, like https://dns.example.net/dns-query.');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('A DoH URL starts with https://.');
  if (u.username || u.password) throw new Error('Leave user names and passwords out of the resolver URL.');
  u.hash = '';
  return u.href;
}

// ---------- response ----------

class Reader {
  constructor(bytes) {
    this.b = bytes;
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.p = 0;
  }
  need(n) {
    if (this.p + n > this.b.length) throw new Error('The response is truncated or malformed.');
  }
  u8() { this.need(1); return this.b[this.p++]; }
  u16() { this.need(2); const v = this.dv.getUint16(this.p); this.p += 2; return v; }
  u32() { this.need(4); const v = this.dv.getUint32(this.p); this.p += 4; return v; }
  bytes(n) { this.need(n); const v = this.b.subarray(this.p, this.p + n); this.p += n; return v; }
  // Name with compression pointers; returns "example.com." (root is ".").
  name() {
    const labels = [];
    let p = this.p;
    let jumped = false;
    for (let hops = 0; ; hops++) {
      if (hops > 127 || p >= this.b.length) throw new Error('A name in the response is malformed.');
      const len = this.b[p];
      if (len === 0) { p++; break; }
      if ((len & 0xc0) === 0xc0) {
        if (p + 1 >= this.b.length) throw new Error('A name in the response is malformed.');
        if (!jumped) this.p = p + 2;
        jumped = true;
        p = ((len & 0x3f) << 8) | this.b[p + 1];
        continue;
      }
      if (len & 0xc0) throw new Error('A name in the response uses an unsupported label type.');
      if (p + 1 + len > this.b.length) throw new Error('A name in the response is truncated.');
      labels.push(labelText(this.b.subarray(p + 1, p + 1 + len)));
      p += 1 + len;
    }
    if (!jumped) this.p = p;
    return labels.length ? labels.join('.') + '.' : '.';
  }
}

// Presentation format: printable ASCII as-is, "." and "\" escaped, the rest
// as \DDD (RFC 1035 §5.1).
function labelText(b) {
  let s = '';
  for (const c of b) {
    if (c === 0x2e || c === 0x5c) s += '\\' + String.fromCharCode(c);
    else if (c > 0x20 && c < 0x7f) s += String.fromCharCode(c);
    else s += '\\' + String(c).padStart(3, '0');
  }
  return s;
}

function charString(b) {
  let s = '';
  for (const c of b) {
    if (c === 0x22 || c === 0x5c) s += '\\' + String.fromCharCode(c);
    else if (c >= 0x20 && c < 0x7f) s += String.fromCharCode(c);
    else s += '\\' + String(c).padStart(3, '0');
  }
  return s;
}

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
const b64 = (b) => { let s = ''; for (const c of b) s += String.fromCharCode(c); return btoa(s); };
const ipv6 = (b) => compressIPv6(b.reduce((n, x) => (n << 8n) | BigInt(x), 0n));
const ipv4 = (b) => formatIPv4(b.reduce((n, x) => (n << 8n) | BigInt(x), 0n));

// Base32hex without padding, for NSEC3 next-hashed-owner names.
function base32hex(b) {
  const A = '0123456789ABCDEFGHIJKLMNOPQRSTUV';
  let bits = 0;
  let v = 0;
  let s = '';
  for (const c of b) {
    v = (v << 8) | c;
    bits += 8;
    while (bits >= 5) { s += A[(v >> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) s += A[(v << (5 - bits)) & 31];
  return s;
}

function typeBitmap(r, end) {
  const types = [];
  while (r.p < end) {
    const win = r.u8();
    const len = r.u8();
    const map = r.bytes(len);
    map.forEach((byte, i) => {
      for (let bit = 0; bit < 8; bit++) if (byte & (0x80 >> bit)) types.push(typeName(win * 256 + i * 8 + bit));
    });
  }
  return types.join(' ');
}

// YYYYMMDDHHmmSS (UTC), as RRSIG shows its validity window.
const sigTime = (t) => new Date(t * 1000).toISOString().replace(/[-:T]/g, '').slice(0, 14);

const SVC_KEYS = ['mandatory', 'alpn', 'no-default-alpn', 'port', 'ipv4hint', 'ech', 'ipv6hint'];

function svcParams(r, end) {
  const out = [];
  while (r.p < end) {
    const key = r.u16();
    const v = r.bytes(r.u16());
    const name = SVC_KEYS[key] ?? `key${key}`;
    let val;
    if (key === 0) val = Array.from({ length: v.length / 2 }, (_, i) => SVC_KEYS[(v[2 * i] << 8) | v[2 * i + 1]] ?? `key${(v[2 * i] << 8) | v[2 * i + 1]}`).join(',');
    else if (key === 1) {
      const ids = [];
      for (let i = 0; i < v.length; i += 1 + v[i]) ids.push(charString(v.subarray(i + 1, i + 1 + v[i])));
      val = ids.join(',');
    } else if (key === 2) val = null;
    else if (key === 3) val = String((v[0] << 8) | v[1]);
    else if (key === 4) val = Array.from({ length: v.length / 4 }, (_, i) => ipv4(v.subarray(4 * i, 4 * i + 4))).join(',');
    else if (key === 6) val = Array.from({ length: v.length / 16 }, (_, i) => ipv6(v.subarray(16 * i, 16 * i + 16))).join(',');
    else if (key === 5) val = b64(v);
    else val = charString(v);
    out.push(val === null ? name : `${name}=${val}`);
  }
  return out.join(' ');
}

// RDATA in presentation format, plus structured fields for the types the
// page explains. Unknown types use RFC 3597's \# form.
function rdata(r, type, len) {
  const end = r.p + len;
  r.need(len);
  const generic = () => { const b = r.bytes(end - r.p); return `\\# ${b.length}${b.length ? ' ' + hex(b) : ''}`; };
  let data;
  let fields = {};
  try {
    switch (type) {
      case 1: data = ipv4(r.bytes(4)); break;
      case 28: data = ipv6(r.bytes(16)); break;
      case 2: case 5: case 12: case 39: data = r.name(); break;
      case 15: { const pref = r.u16(); const host = r.name(); fields = { preference: pref, host }; data = `${pref} ${host}`; break; }
      case 16: case 99: {
        const parts = [];
        while (r.p < end) parts.push(r.bytes(r.u8()));
        fields = { text: parts.map((p) => new TextDecoder().decode(p)).join('') };
        data = parts.map((p) => `"${charString(p)}"`).join(' ');
        break;
      }
      case 6: {
        const mname = r.name(); const rname = r.name();
        const [serial, refresh, retry, expire, minimum] = [r.u32(), r.u32(), r.u32(), r.u32(), r.u32()];
        fields = { mname, rname, serial, refresh, retry, expire, minimum };
        data = `${mname} ${rname} ${serial} ${refresh} ${retry} ${expire} ${minimum}`;
        break;
      }
      case 33: {
        const [priority, weight, port] = [r.u16(), r.u16(), r.u16()];
        const target = r.name();
        fields = { priority, weight, port, target };
        data = `${priority} ${weight} ${port} ${target}`;
        break;
      }
      case 13: { const cpu = r.bytes(r.u8()); const os = r.bytes(r.u8()); data = `"${charString(cpu)}" "${charString(os)}"`; break; }
      case 35: {
        const [order, pref] = [r.u16(), r.u16()];
        const [flags, service, regexp] = [r.bytes(r.u8()), r.bytes(r.u8()), r.bytes(r.u8())];
        data = `${order} ${pref} "${charString(flags)}" "${charString(service)}" "${charString(regexp)}" ${r.name()}`;
        break;
      }
      case 257: {
        const flags = r.u8(); const tag = charString(r.bytes(r.u8())); const value = charString(r.bytes(end - r.p));
        fields = { flags, tag, value };
        data = `${flags} ${tag} "${value}"`;
        break;
      }
      case 43: case 59: {
        const [tag, alg, digestType] = [r.u16(), r.u8(), r.u8()];
        fields = { keyTag: tag, algorithm: alg, digestType };
        data = `${tag} ${alg} ${digestType} ${hex(r.bytes(end - r.p))}`;
        break;
      }
      case 48: case 60: {
        const [flags, proto, alg] = [r.u16(), r.u8(), r.u8()];
        const key = r.bytes(end - r.p);
        fields = { flags, algorithm: alg, keyTag: keyTag(flags, proto, alg, key), role: flags & 1 ? 'KSK' : 'ZSK' };
        data = `${flags} ${proto} ${alg} ${b64(key)}`;
        break;
      }
      case 46: {
        const covered = typeName(r.u16());
        const [alg, labels, origTtl, exp, inc, tag] = [r.u8(), r.u8(), r.u32(), r.u32(), r.u32(), r.u16()];
        const signer = r.name();
        fields = { covered, algorithm: alg, expiration: exp, inception: inc, keyTag: tag, signer };
        data = `${covered} ${alg} ${labels} ${origTtl} ${sigTime(exp)} ${sigTime(inc)} ${tag} ${signer} ${b64(r.bytes(end - r.p))}`;
        break;
      }
      case 47: data = `${r.name()} ${typeBitmap(r, end)}`; break;
      case 50: {
        const [alg, flags, iter] = [r.u8(), r.u8(), r.u16()];
        const salt = r.bytes(r.u8());
        const next = r.bytes(r.u8());
        data = `${alg} ${flags} ${iter} ${salt.length ? hex(salt) : '-'} ${base32hex(next)} ${typeBitmap(r, end)}`.trim();
        break;
      }
      case 51: {
        const [alg, flags, iter] = [r.u8(), r.u8(), r.u16()];
        const salt = r.bytes(r.u8());
        data = `${alg} ${flags} ${iter} ${salt.length ? hex(salt) : '-'}`;
        break;
      }
      case 52: { const [u, s, m] = [r.u8(), r.u8(), r.u8()]; data = `${u} ${s} ${m} ${hex(r.bytes(end - r.p))}`; break; }
      case 44: { const [alg, fp] = [r.u8(), r.u8()]; data = `${alg} ${fp} ${hex(r.bytes(end - r.p))}`; break; }
      case 64: case 65: {
        const prio = r.u16(); const target = r.name();
        const params = svcParams(r, end);
        data = `${prio} ${target}${params ? ' ' + params : ''}`;
        break;
      }
      default: data = generic();
    }
    if (r.p !== end) throw new Error('length mismatch');
  } catch {
    r.p = end - len;
    data = generic();
    fields = {};
  }
  r.p = end;
  return { data, fields };
}

// RFC 4034 Appendix B key tag.
function keyTag(flags, proto, alg, key) {
  const b = [flags >> 8, flags & 255, proto, alg, ...key];
  let ac = 0;
  b.forEach((x, i) => { ac += i & 1 ? x : x << 8; });
  ac += (ac >> 16) & 0xffff;
  return ac & 0xffff;
}

const EDE = {
  0: 'Other', 1: 'Unsupported DNSKEY algorithm', 2: 'Unsupported DS digest type', 3: 'Stale answer', 4: 'Forged answer',
  5: 'DNSSEC indeterminate', 6: 'DNSSEC bogus', 7: 'Signature expired', 8: 'Signature not yet valid', 9: 'DNSKEY missing',
  10: 'RRSIGs missing', 11: 'No zone key bit set', 12: 'NSEC missing', 13: 'Cached error', 14: 'Not ready', 15: 'Blocked',
  16: 'Censored', 17: 'Filtered', 18: 'Prohibited', 19: 'Stale NXDOMAIN answer', 20: 'Not authoritative', 21: 'Not supported',
  22: 'No reachable authority', 23: 'Network error', 24: 'Invalid data',
};

export function decodeMessage(bytes) {
  const r = new Reader(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  if (r.b.length < 12) throw new Error('The response is too short to be a DNS message.');
  const id = r.u16();
  const f = r.u16();
  const counts = [r.u16(), r.u16(), r.u16(), r.u16()];
  const flags = {
    qr: !!(f & 0x8000), aa: !!(f & 0x0400), tc: !!(f & 0x0200), rd: !!(f & 0x0100),
    ra: !!(f & 0x0080), ad: !!(f & 0x0020), cd: !!(f & 0x0010),
  };
  const opcode = (f >> 11) & 15;
  let rcode = f & 15;
  const question = [];
  for (let i = 0; i < counts[0]; i++) question.push({ name: r.name(), type: typeName(r.u16()), class: r.u16() });
  const sections = [[], [], []];
  let edns = null;
  for (let s = 0; s < 3; s++) {
    for (let i = 0; i < counts[s + 1]; i++) {
      const name = r.name();
      const type = r.u16();
      const cls = r.u16();
      const ttl = r.u32();
      const len = r.u16();
      if (type === 41) {
        const end = r.p + len;
        r.need(len);
        edns = { udpSize: cls, version: (ttl >> 16) & 255, do: !!(ttl & 0x8000), errors: [] };
        rcode |= (ttl >>> 24) << 4;
        while (r.p + 4 <= end) {
          const code = r.u16();
          const v = r.bytes(Math.min(r.u16(), end - r.p));
          if (code === 15 && v.length >= 2) {
            const info = (v[0] << 8) | v[1];
            const text = new TextDecoder().decode(v.subarray(2)).replace(/\0+$/, '');
            edns.errors.push({ code: info, name: EDE[info] ?? `Code ${info}`, text });
          }
        }
        r.p = end;
        continue;
      }
      const { data, fields } = rdata(r, type, len);
      sections[s].push({ name, type: typeName(type), typeCode: type, class: cls === 1 ? 'IN' : cls === 3 ? 'CH' : `CLASS${cls}`, ttl, data, fields });
    }
  }
  return { id, opcode, flags, rcode, rcodeName: rcodeName(rcode), question, answer: sections[0], authority: sections[1], additional: sections[2], edns };
}

// ---------- presentation ----------

// "3600" → "1h", "86400" → "1d", "90061" → "1d 1h 1m 1s".
export function formatTtl(s) {
  if (s === 0) return '0s';
  const parts = [];
  for (const [n, u] of [[604800, 'w'], [86400, 'd'], [3600, 'h'], [60, 'm'], [1, 's']]) {
    if (s >= n) { parts.push(Math.floor(s / n) + u); s %= n; }
  }
  return parts.join(' ');
}

const FLAG_ORDER = ['qr', 'aa', 'tc', 'rd', 'ra', 'ad', 'cd'];

// dig-like text for copying.
export function digText(msg, { server = '', ms = null, size = null } = {}) {
  const q = msg.question[0];
  const line = (rr) => `${rr.name.padEnd(24)} ${String(rr.ttl).padStart(6)} ${rr.class.padEnd(3)} ${rr.type.padEnd(6)} ${rr.data}`;
  const out = [
    `;; ->>HEADER<<- opcode: ${msg.opcode === 0 ? 'QUERY' : msg.opcode}, status: ${msg.rcodeName}, id: ${msg.id}`,
    `;; flags: ${FLAG_ORDER.filter((k) => msg.flags[k]).join(' ')}; QUERY: ${msg.question.length}, ANSWER: ${msg.answer.length}, AUTHORITY: ${msg.authority.length}, ADDITIONAL: ${msg.additional.length + (msg.edns ? 1 : 0)}`,
  ];
  if (msg.edns) {
    out.push('', ';; OPT PSEUDOSECTION:', `; EDNS: version: ${msg.edns.version}, flags:${msg.edns.do ? ' do' : ''}; udp: ${msg.edns.udpSize}`);
    for (const e of msg.edns.errors) out.push(`; EDE: ${e.code} (${e.name})${e.text ? `: (${e.text})` : ''}`);
  }
  if (q) out.push('', ';; QUESTION SECTION:', `;${q.name.padEnd(23)}        ${q.class === 1 ? 'IN' : q.class}  ${q.type}`);
  for (const [title, list] of [['ANSWER', msg.answer], ['AUTHORITY', msg.authority], ['ADDITIONAL', msg.additional]]) {
    if (list.length) out.push('', `;; ${title} SECTION:`, ...list.map(line));
  }
  out.push('');
  if (ms != null) out.push(`;; Query time: ${Math.round(ms)} msec`);
  if (server) out.push(`;; SERVER: ${server} (HTTPS)`);
  if (size != null) out.push(`;; MSG SIZE  rcvd: ${size}`);
  return out.join('\n');
}

// Sorted, TTL-free answer data, to compare resolvers' answers.
export function answerKey(msg) {
  if (msg.rcode !== 0) return msg.rcodeName;
  const rows = msg.answer.filter((rr) => rr.type !== 'RRSIG').map((rr) => `${rr.type} ${rr.data}`).sort();
  return rows.length ? rows.join('\n') : 'NODATA';
}
