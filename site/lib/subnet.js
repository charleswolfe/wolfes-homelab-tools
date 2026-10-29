// IPv4 / IPv6 subnet maths. Addresses are BigInts for both families, so the
// same code handles 32 and 128 bits.

const BITS = { 4: 32, 6: 128 };
const ones = (n) => (1n << BigInt(n)) - 1n;
export const maskOf = (bits, prefix) => ones(bits) ^ ones(bits - prefix);

// ---------- parsing ----------

export function parseIPv4(s) {
  const parts = s.split('.');
  if (parts.length !== 4 || parts.some((p) => p === '')) throw new Error(`“${s}” isn’t an IPv4 address: it needs four numbers separated by dots, like 192.168.1.10.`);
  let n = 0n;
  for (const p of parts) {
    if (!/^\d+$/.test(p)) throw new Error(`“${p}” in ${s} isn’t a number.`);
    if (p.length > 1 && p[0] === '0') throw new Error(`“${p}” in ${s} has a leading zero. Some tools read that as octal, so it’s ambiguous; write ${Number(p)}.`);
    if (Number(p) > 255) throw new Error(`${p} in ${s} is out of range; each number must be 0–255.`);
    n = (n << 8n) | BigInt(p);
  }
  return n;
}

export function parseIPv6(s) {
  if (!/^[0-9a-fA-F:.]+$/.test(s)) throw new Error(`“${s}” contains characters that can’t appear in an IPv6 address.`);
  const halves = s.split('::');
  if (halves.length > 2) throw new Error(`“${s}” uses “::” more than once; it may only appear once.`);
  const groups = (h) => (h === '' ? [] : h.split(':'));
  const head = groups(halves[0]);
  const tail = halves.length === 2 ? groups(halves[1]) : [];
  const words = [];
  const all = [...head, ...tail];
  // A trailing dotted quad (::ffff:192.0.2.1) counts as two groups.
  const last = all[all.length - 1];
  let v4 = null;
  if (last && last.includes('.')) {
    if (halves.length === 2 && !tail.length) throw new Error(`In “${s}” the dotted IPv4 part must come at the end.`);
    v4 = parseIPv4(last);
    (tail.length ? tail : head).pop();
  }
  for (const g of [...head, ...tail]) {
    if (g === '') throw new Error(`“${s}” has an empty group; use “::” once to skip zeros.`);
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) throw new Error(`Group “${g}” in ${s} isn’t 1–4 hex digits.`);
  }
  const count = head.length + tail.length + (v4 !== null ? 2 : 0);
  if (halves.length === 1 && count !== 8) throw new Error(`“${s}” has ${count} groups; an IPv6 address has 8 (use “::” to stand for a run of zeros).`);
  if (halves.length === 2 && count > 7) throw new Error(`“${s}” has too many groups to also contain “::”.`);
  const fill = 8 - count;
  for (const g of head) words.push(parseInt(g, 16));
  for (let i = 0; i < (halves.length === 2 ? fill : 0); i++) words.push(0);
  for (const g of tail) words.push(parseInt(g, 16));
  let n = 0n;
  for (const w of words) n = (n << 16n) | BigInt(w);
  if (v4 !== null) n = (n << 32n) | v4;
  return n;
}

// Contiguous netmask → prefix length, or -1.
function maskToPrefix(n, bits) {
  for (let p = 0; p <= bits; p++) if (maskOf(bits, p) === n) return p;
  return -1;
}

// One address: IPv4, IPv6 (optionally [bracketed] or with a %zone).
export function parseAddress(raw) {
  let s = raw.trim();
  const notes = [];
  if (/^\[.*\]$/.test(s)) s = s.slice(1, -1);
  if (s.includes(':')) {
    const zone = s.indexOf('%');
    if (zone !== -1) {
      notes.push(`Zone “${s.slice(zone)}” ignored; it names an interface on one host and isn’t part of the address.`);
      s = s.slice(0, zone);
    }
    return { version: 6, bits: 128, addr: parseIPv6(s), notes };
  }
  return { version: 4, bits: 32, addr: parseIPv4(s), notes };
}

// "192.168.1.10/24", "192.168.1.10 255.255.255.0", "10.0.0.1/0.0.0.255",
// "2001:db8::/48" or a bare address (a single-host network).
export function parseNetwork(raw) {
  const s = raw.trim().replace(/\s*\/\s*/, '/');
  if (!s) return null;
  const m = /^(\S+?)(?:\/(\S+)|\s+(\S+))?$/.exec(s);
  if (!m) throw new Error('Enter one address with an optional prefix, like 192.168.1.0/24 or 2001:db8::/48.');
  const [, addrPart, slash, spaced] = m;
  const a = parseAddress(addrPart);
  const maskPart = slash ?? spaced;
  let prefix = a.bits;
  if (maskPart === undefined) {
    a.notes.push(`No prefix given, so this is a single address (/${a.bits}). Add one, like /24, or use the slider.`);
  } else if (/^\d+$/.test(maskPart)) {
    prefix = Number(maskPart);
    if (prefix > a.bits) throw new Error(`/${prefix} is longer than an IPv${a.version} address; the maximum is /${a.bits}.`);
  } else if (a.version === 4 && maskPart.includes('.')) {
    const mask = parseIPv4(maskPart);
    prefix = maskToPrefix(mask, 32);
    if (prefix === -1) {
      const wild = maskToPrefix(mask ^ ones(32), 32);
      if (wild === -1) throw new Error(`${maskPart} isn’t a valid netmask: its 1 bits must all come first (like 255.255.255.0).`);
      prefix = wild;
      a.notes.push(`${maskPart} was read as a wildcard (inverse) mask, as used in Cisco ACLs and OSPF; the netmask is ${formatIPv4(maskOf(32, wild))}.`);
    }
  } else {
    throw new Error(`“${maskPart}” isn’t a prefix length${a.version === 4 ? ' or netmask' : ''}. Use a number like /${a.version === 4 ? 24 : 64}.`);
  }
  return { version: a.version, bits: a.bits, addr: a.addr, prefix, notes: a.notes };
}

// ---------- formatting ----------

export function formatIPv4(n) {
  return [24n, 16n, 8n, 0n].map((s) => (n >> s) & 255n).join('.');
}

const words16 = (n) => Array.from({ length: 8 }, (_, i) => Number((n >> BigInt(112 - 16 * i)) & 0xffffn));

export function expandIPv6(n) {
  return words16(n).map((w) => w.toString(16).padStart(4, '0')).join(':');
}

// RFC 5952: lowercase, no leading zeros, the longest run (2+) of zero groups
// becomes "::" (the first one on a tie), IPv4-mapped addresses keep the
// dotted tail.
export function compressIPv6(n) {
  if (n >> 32n === 0xffffn) return `::ffff:${formatIPv4(n & ones(32))}`;
  const w = words16(n);
  let best = -1;
  let bestLen = 1;
  for (let i = 0; i < 8;) {
    if (w[i] !== 0) { i++; continue; }
    let j = i;
    while (j < 8 && w[j] === 0) j++;
    if (j - i > bestLen) { best = i; bestLen = j - i; }
    i = j;
  }
  const hex = w.map((x) => x.toString(16));
  if (best === -1) return hex.join(':');
  return `${hex.slice(0, best).join(':')}::${hex.slice(best + bestLen).join(':')}`;
}

export const formatAddress = (version, n) => (version === 4 ? formatIPv4(n) : compressIPv6(n));

// Bit string, split into octets (IPv4) or 16-bit groups (IPv6).
export function bitGroups(n, bits) {
  const size = bits === 32 ? 8 : 16;
  const s = n.toString(2).padStart(bits, '0');
  return Array.from({ length: bits / size }, (_, i) => s.slice(i * size, (i + 1) * size));
}

// ---------- special-purpose ranges (IANA registries) ----------

const RANGES = {
  4: [
    ['0.0.0.0/8', 'This network', 'RFC 791. Only valid as a source address; 0.0.0.0 means “any address” to most software.'],
    ['10.0.0.0/8', 'Private', 'RFC 1918. Not routed on the internet.'],
    ['100.64.0.0/10', 'Shared address space (CGNAT)', 'RFC 6598. Used by ISPs for carrier-grade NAT, and by Tailscale for device addresses.'],
    ['127.0.0.0/8', 'Loopback', 'RFC 1122. Never leaves the host.'],
    ['169.254.0.0/16', 'Link-local', 'RFC 3927. Self-assigned when DHCP fails; also cloud metadata (169.254.169.254).'],
    ['172.16.0.0/12', 'Private', 'RFC 1918. Docker’s default bridge networks come from here.'],
    ['192.0.0.0/24', 'IETF protocol assignments', 'RFC 6890.'],
    ['192.0.2.0/24', 'Documentation (TEST-NET-1)', 'RFC 5737. For examples only; never used on real networks.'],
    ['192.88.99.0/24', '6to4 relay anycast (deprecated)', 'RFC 7526.'],
    ['192.168.0.0/16', 'Private', 'RFC 1918. The usual home and homelab range.'],
    ['198.18.0.0/15', 'Benchmarking', 'RFC 2544. For network device testing.'],
    ['198.51.100.0/24', 'Documentation (TEST-NET-2)', 'RFC 5737. For examples only.'],
    ['203.0.113.0/24', 'Documentation (TEST-NET-3)', 'RFC 5737. For examples only.'],
    ['224.0.0.0/4', 'Multicast', 'RFC 5771. mDNS (224.0.0.251) and SSDP (239.255.255.250) live here.'],
    ['240.0.0.0/4', 'Reserved', 'RFC 1112. Formerly Class E; not usable on most systems.'],
    ['255.255.255.255/32', 'Limited broadcast', 'RFC 919. Every host on the local segment.'],
  ],
  6: [
    ['::/128', 'Unspecified', 'RFC 4291. “No address”; :: also means “any address” to most software.'],
    ['::1/128', 'Loopback', 'RFC 4291. Never leaves the host.'],
    ['::ffff:0:0/96', 'IPv4-mapped', 'RFC 4291. How dual-stack sockets show IPv4 peers.'],
    ['64:ff9b::/96', 'NAT64', 'RFC 6052. IPv4 addresses embedded for NAT64/DNS64.'],
    ['64:ff9b:1::/48', 'Local-use NAT64', 'RFC 8215.'],
    ['100::/64', 'Discard-only', 'RFC 6666. Traffic is dropped (remote-triggered black hole).'],
    ['2000::/3', 'Global unicast', 'RFC 4291. Public, internet-routable addresses.'],
    ['2001::/32', 'Teredo', 'RFC 4380. IPv6-over-UDP tunnelling.'],
    ['2001:db8::/32', 'Documentation', 'RFC 3849. For examples only; never used on real networks.'],
    ['2002::/16', '6to4', 'RFC 3056. Embeds a public IPv4 address (deprecated).'],
    ['3fff::/20', 'Documentation', 'RFC 9637. For examples only.'],
    ['fc00::/7', 'Unique local (ULA)', 'RFC 4193. IPv6’s private range; pick a random /48 from fd00::/8.'],
    ['fe80::/10', 'Link-local', 'RFC 4291. Auto-configured on every interface; not routed.'],
    ['ff00::/8', 'Multicast', 'RFC 4291. ff02::1 is all nodes on the link, ff02::fb is mDNS.'],
  ],
};

const SPECIAL = Object.fromEntries(Object.entries(RANGES).map(([v, list]) => [v, list.map(([cidr, name, note]) => {
  const n = parseNetwork(cidr);
  return { cidr, name, note, network: n.addr, prefix: n.prefix };
})]));

// The most specific special range containing the whole network.
export function classify(version, network, prefix) {
  const bits = BITS[version];
  let best = null;
  for (const r of SPECIAL[version]) {
    if (r.prefix <= prefix && (network & maskOf(bits, r.prefix)) === r.network && (!best || r.prefix > best.prefix)) best = r;
  }
  if (best) return best;
  const spans = SPECIAL[version].some((r) => r.prefix >= prefix && (r.network & maskOf(bits, prefix)) === network);
  if (spans) return { name: 'Mixed', note: 'This block contains several special-purpose ranges.' };
  return version === 4
    ? { name: 'Public', note: 'Internet-routable address space.' }
    : { name: 'Reserved', note: 'Not assigned for use by IANA.' };
}

// ---------- describing a network ----------

export function legacyClass(n) {
  const first = Number(n >> 24n);
  if (first < 128) return 'A';
  if (first < 192) return 'B';
  if (first < 224) return 'C';
  if (first < 240) return 'D';
  return 'E';
}

// DNS zone(s) for reverse lookups. Prefixes between label boundaries
// (8 bits for in-addr.arpa, 4 for ip6.arpa) cover several zones, and
// longer-than-the-last-label prefixes sit inside one (RFC 2317 delegation).
export function reverseZones(version, network, prefix) {
  const bits = BITS[version];
  const unit = version === 4 ? 8 : 4;
  const labelsFor = (n, count) => {
    if (version === 4) return [24n, 16n, 8n, 0n].slice(0, count).map((s) => (n >> s) & 255n).reverse();
    return Array.from({ length: count }, (_, i) => ((n >> BigInt(124 - 4 * i)) & 15n).toString(16)).reverse();
  };
  const suffix = version === 4 ? 'in-addr.arpa' : 'ip6.arpa';
  const zone = (n, count) => [...labelsFor(n, count), suffix].join('.');
  if (prefix % unit === 0) return { zones: [zone(network, prefix / unit)], count: 1n, classless: false };
  if (prefix > bits - unit) return { zones: [zone(network, Math.floor(prefix / unit))], count: 1n, classless: true };
  const up = Math.ceil(prefix / unit) * unit;
  const count = 1n << BigInt(up - prefix);
  const step = 1n << BigInt(bits - up);
  return { zones: [zone(network, up / unit), zone(network + (count - 1n) * step, up / unit)], count, classless: false };
}

export function describe({ version, bits, addr, prefix }) {
  const mask = maskOf(bits, prefix);
  const network = addr & mask;
  const last = network | (ones(bits) ^ mask);
  const size = 1n << BigInt(bits - prefix);
  const d = { version, bits, prefix, addr, mask, network, last, size, cidr: `${formatAddress(version, network)}/${prefix}` };
  if (version === 4) {
    d.wildcard = ones(32) ^ mask;
    if (prefix <= 30) Object.assign(d, { first: network + 1n, lastUsable: last - 1n, usable: size - 2n, broadcast: last });
    else if (prefix === 31) Object.assign(d, { first: network, lastUsable: last, usable: 2n, broadcast: null }); // RFC 3021 point-to-point
    else Object.assign(d, { first: network, lastUsable: network, usable: 1n, broadcast: null });
    d.class = legacyClass(network);
  } else {
    Object.assign(d, { first: network, lastUsable: last, usable: size, broadcast: null });
    if (prefix < 64) d.subnets64 = 1n << BigInt(64 - prefix);
  }
  d.type = classify(version, network, prefix);
  d.reverse = reverseZones(version, network, prefix);
  d.embeddedIPv4 = version === 6 ? embeddedIPv4(addr) : null;
  d.hostBitsSet = addr !== network;
  return d;
}

// IPv4 addresses carried inside some IPv6 ranges.
export function embeddedIPv4(n) {
  if (n >> 32n === 0xffffn) return { kind: 'IPv4-mapped', v4: formatIPv4(n & ones(32)) };
  if (n >> 32n === 0x64ff9b0000000000000000n) return { kind: 'NAT64', v4: formatIPv4(n & ones(32)) };
  if (n >> 112n === 0x2002n) return { kind: '6to4', v4: formatIPv4((n >> 80n) & ones(32)) };
  return null;
}

// What role a single address plays inside a described network.
export function addressRole(d, n) {
  if (d.version === 4 && d.prefix <= 30) {
    if (n === d.network) return 'network address, not usable by a host';
    if (n === d.broadcast) return 'broadcast address, not usable by a host';
  }
  if (d.version === 6 && d.prefix < 127 && n === d.network) return 'subnet-router anycast address';
  return 'usable host address';
}

// ---------- splitting and membership ----------

// The first `limit` subnets of length newPrefix inside d, plus the total count.
export function split(d, newPrefix, limit = 256) {
  if (newPrefix <= d.prefix || newPrefix > d.bits) throw new Error(`Pick a prefix between /${d.prefix + 1} and /${d.bits}.`);
  const count = 1n << BigInt(newPrefix - d.prefix);
  const step = 1n << BigInt(d.bits - newPrefix);
  const shown = count < BigInt(limit) ? Number(count) : limit;
  const items = Array.from({ length: shown }, (_, i) =>
    describe({ version: d.version, bits: d.bits, addr: d.network + BigInt(i) * step, prefix: newPrefix }));
  return { count, step, items };
}

export function* subnetCidrs(d, newPrefix) {
  const step = 1n << BigInt(d.bits - newPrefix);
  for (let n = d.network; n <= d.last; n += step) yield `${formatAddress(d.version, n)}/${newPrefix}`;
}

// Where an address or CIDR sits relative to network d.
export function locate(d, raw) {
  const other = parseNetwork(raw);
  if (!other) return null;
  if (other.version !== d.version) return { relation: 'other-version', other };
  const o = describe(other);
  const single = other.prefix === other.bits;
  if (o.network >= d.network && o.last <= d.last) {
    return { relation: 'inside', other, o, role: single ? addressRole(d, other.addr) : null };
  }
  if (o.network <= d.network && o.last >= d.last) return { relation: 'contains', other, o };
  return { relation: 'outside', other, o };
}
