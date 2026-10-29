import {
  parseNetwork, describe, split, subnetCidrs, locate, formatAddress, expandIPv6, bitGroups, addressRole, maskOf,
} from '/lib/subnet.js';
import { $, storage, debounce, copyText, kvRow, alertHTML, escapeHTML, toast } from '/assets/ui.js';

const SPLIT_ROWS = 256;
const COPY_LIMIT = 65536;

const el = {
  input: $('#input'),
  prefix: $('#prefix'),
  prefixOut: $('#prefix-out'),
  messages: $('#messages'),
  result: $('#result'),
  cidr: $('#summary-cidr'),
  hosts: $('#summary-hosts'),
  type: $('#summary-type'),
  rows: $('#rows'),
  bits: $('#bits'),
  splitPanel: $('#split-panel'),
  splitPrefix: $('#split-prefix'),
  splitSummary: $('#split-summary'),
  splitHead: $('#split-head'),
  splitRows: $('#split-rows'),
  splitMore: $('#split-more'),
  splitMoreText: $('#split-more-text'),
  splitCopy: $('#split-copy'),
  checkPanel: $('#check-panel'),
  check: $('#check'),
  checkRows: $('#check-rows'),
  ref4: $('#ref4-rows'),
  ref6: $('#ref6-rows'),
};

const fmt = (n) => n.toLocaleString();
// 2^k counts stay readable: exact up to a trillion, then as a power of two.
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const pow2 = (k) => '2' + [...String(k)].map((c) => SUP[c]).join('');
const count = (k) => (k <= 40 ? fmt(1n << BigInt(k)) : pow2(k));
const addr = (d, n) => formatAddress(d.version, n);

const saved = storage.get('subnet', {});
let net = null; // describe() of the current input
let splitPrefix = saved.split ?? null;

function persist() {
  storage.set('subnet', { input: el.input.value, split: splitPrefix, check: el.check.value });
  const h = el.input.value.trim();
  history.replaceState(null, '', h ? '#' + encodeURI(h) : location.pathname);
}

// ---------- main result ----------

function render() {
  el.messages.innerHTML = '';
  let parsed;
  try {
    parsed = parseNetwork(el.input.value);
  } catch (err) {
    el.input.classList.add('is-invalid');
    el.messages.innerHTML = alertHTML('error', err.message);
    return show(null);
  }
  el.input.classList.remove('is-invalid');
  if (!parsed) return show(null);
  net = describe(parsed);
  const notes = [...parsed.notes];
  if (net.hostBitsSet) notes.push(`${addr(net, net.addr)} has host bits set, so the network it belongs to is ${net.cidr}.`);
  el.messages.innerHTML = notes.map((n) => alertHTML('info', n)).join('');
  show(net);
}

function show(d) {
  net = d;
  el.result.hidden = !d;
  el.splitPanel.hidden = !d || d.prefix === d.bits;
  el.checkPanel.hidden = !d;
  syncSlider();
  renderRef4();
  if (!d) return;

  el.cidr.textContent = d.cidr;
  el.type.textContent = d.type.name;
  el.type.title = d.type.note;
  el.hosts.textContent = d.prefix === d.bits
    ? 'A single address'
    : `${d.version === 4 ? fmt(d.usable) + ' usable hosts' : count(d.bits - d.prefix) + ' addresses'} · ${addr(d, d.first)} – ${addr(d, d.lastUsable)}`;

  el.rows.innerHTML = (d.version === 4 ? rows4(d) : rows6(d)).join('');
  el.bits.innerHTML = bitsHTML(d);
  renderSplit();
  renderCheck();
}

function rows4(d) {
  const r = [];
  if (d.hostBitsSet) r.push(kvRow('Address', addr(d, d.addr), { sub: addressRole(d, d.addr) }));
  r.push(
    kvRow('Network address', addr(d, d.network)),
    kvRow('Usable host range', `${addr(d, d.first)} – ${addr(d, d.lastUsable)}`),
    d.broadcast !== null
      ? kvRow('Broadcast address', addr(d, d.broadcast))
      : kvRow('Broadcast address', d.prefix === 31 ? 'None: a /31 is a point-to-point link where both addresses are usable (RFC 3021)' : 'None: a single host', { plain: true, muted: true, copy: false }),
    kvRow('Addresses', fmt(d.size), { sub: pow2(32 - d.prefix) }),
    kvRow('Usable hosts', fmt(d.usable)),
    kvRow('Netmask', addr(d, d.mask), { sub: `/${d.prefix}` }),
    kvRow('Wildcard mask', addr(d, d.wildcard), { sub: 'ACLs, OSPF' }),
    kvRow('Type', `${d.type.name}. ${d.type.note}`, { plain: true, copy: false }),
    kvRow('Legacy class', `Class ${d.class}`, { sub: 'pre-1993, informational', plain: true, copy: false }),
    reverseRow(d),
    kvRow('As a number', `${d.addr} · 0x${d.addr.toString(16).toUpperCase().padStart(8, '0')}`, { copy: false }),
  );
  return r;
}

function rows6(d) {
  const r = [];
  if (d.hostBitsSet) r.push(kvRow('Address', addr(d, d.addr), { sub: addressRole(d, d.addr) }));
  r.push(
    kvRow('Network address', addr(d, d.network)),
    kvRow('Range', `${addr(d, d.first)} – ${addr(d, d.last)}`),
    kvRow('Addresses', fmt(d.size), { sub: pow2(128 - d.prefix) }),
  );
  if (d.subnets64) r.push(kvRow('/64 networks', fmt(d.subnets64), { sub: 'one per LAN or VLAN' }));
  else if (d.prefix > 64) r.push(kvRow('/64 networks', `None: SLAAC needs a whole /64, so hosts here need static addresses or DHCPv6`, { plain: true, muted: true, copy: false }));
  r.push(
    kvRow('Netmask', expandIPv6(d.mask), { sub: `/${d.prefix}` }),
    kvRow('Type', `${d.type.name}. ${d.type.note}`, { plain: true, copy: false }),
  );
  if (d.embeddedIPv4) r.push(kvRow('Embedded IPv4', d.embeddedIPv4.v4, { sub: d.embeddedIPv4.kind }));
  r.push(reverseRow(d), kvRow('Expanded', expandIPv6(d.addr)));
  return r;
}

function reverseRow(d) {
  const z = d.reverse;
  if (z.count === 1n) return kvRow('Reverse DNS zone', z.zones[0], { sub: z.classless ? 'contains this block (RFC 2317)' : '' });
  return kvRow('Reverse DNS zones', `${z.zones[0]} … ${z.zones[1]}`, { sub: `${fmt(z.count)} zones`, copy: false });
}

// Address (and, for IPv4, netmask) in binary with the network bits highlighted.
function bitsHTML(d) {
  const sep = d.version === 4 ? '.' : ':';
  const line = (label, n) => {
    let pos = 0;
    const groups = bitGroups(n, d.bits).map((g) => {
      const net = Math.max(0, Math.min(g.length, d.prefix - pos));
      pos += g.length;
      return `<span class="b-net">${g.slice(0, net)}</span><span class="b-host">${g.slice(net)}</span>`;
    });
    return `<div class="bits-row"><span class="bits-label">${label}</span><code>${groups.join(`<span class="b-sep">${sep}</span>`)}</code></div>`;
  };
  return line('Address', d.addr) + (d.version === 4 ? line('Netmask', d.mask) : '') +
    `<div class="bits-legend"><span><i class="b-net-swatch"></i>Network (${d.prefix} bits)</span><span><i class="b-host-swatch"></i>Host (${d.bits - d.prefix} bits)</span></div>`;
}

// ---------- prefix slider ----------

function syncSlider() {
  const bits = net ? net.bits : 32;
  el.prefix.max = String(bits);
  el.prefix.disabled = !net;
  el.prefix.value = net ? String(net.prefix) : '24';
  el.prefixOut.value = net ? `/${net.prefix}` : '';
}

function setPrefix(p) {
  if (!net) return;
  el.input.value = `${addr(net, net.addr)}/${p}`;
  render();
  persist();
}

// ---------- splitting ----------

function defaultSplit(d) {
  if (d.version === 6 && d.prefix < 64) return 64;
  return Math.min(d.bits, d.prefix + 2);
}

function renderSplit() {
  const d = net;
  if (!d || d.prefix === d.bits) return;
  if (!(splitPrefix > d.prefix && splitPrefix <= d.bits)) splitPrefix = defaultSplit(d);
  const options = [];
  for (let p = d.prefix + 1; p <= d.bits; p++) {
    options.push(`<option value="${p}">/${p} · ${count(p - d.prefix)} × ${count(d.bits - p)}</option>`);
  }
  el.splitPrefix.innerHTML = options.join('');
  el.splitPrefix.value = String(splitPrefix);

  const s = split(d, splitPrefix, SPLIT_ROWS);
  const each = d.version === 4
    ? `${fmt(s.items[0].usable)} usable ${s.items[0].usable === 1n ? 'host' : 'hosts'} each`
    : `${count(d.bits - splitPrefix)} addresses each`;
  el.splitSummary.textContent = `${count(splitPrefix - d.prefix)} subnets of /${splitPrefix}, ${each}.`;

  const v4 = d.version === 4;
  el.splitHead.innerHTML = ['#', 'Subnet', v4 ? 'Usable hosts' : 'Range', ...(v4 ? ['Broadcast'] : [])].map((h) => `<th>${h}</th>`).join('');
  el.splitRows.innerHTML = s.items.map((x, i) => `<tr>
    <td class="num">${i + 1}</td>
    <td>${escapeHTML(x.cidr)}</td>
    <td>${escapeHTML(`${addr(d, x.first)} – ${addr(d, x.lastUsable)}`)}</td>
    ${v4 ? `<td>${x.broadcast === null ? '<span class="null">none</span>' : escapeHTML(addr(d, x.broadcast))}</td>` : ''}
  </tr>`).join('');

  el.splitMore.hidden = s.count <= BigInt(SPLIT_ROWS);
  el.splitMoreText.textContent = s.count > BigInt(COPY_LIMIT)
    ? `Showing the first ${SPLIT_ROWS} of ${count(splitPrefix - d.prefix)} subnets. Copy list copies the first ${fmt(COPY_LIMIT)}.`
    : `Showing the first ${SPLIT_ROWS} of ${fmt(s.count)} subnets. Copy list copies them all.`;
}

function copySplit() {
  if (!net) return;
  const out = [];
  for (const c of subnetCidrs(net, splitPrefix)) {
    out.push(c);
    if (out.length >= COPY_LIMIT) break;
  }
  copyText(out.join('\n'), el.splitCopy);
}

// ---------- membership check ----------

function renderCheck() {
  const d = net;
  const tokens = el.check.value.split(/[\s,;]+/).filter(Boolean);
  if (!d || !tokens.length) { el.checkRows.innerHTML = ''; return; }
  el.checkRows.innerHTML = tokens.slice(0, 100).map((t) => {
    let r;
    try {
      r = locate(d, t);
    } catch (err) {
      return kvRow(t, err.message, { plain: true, copy: false, badge: '<span class="badge badge-danger">Invalid</span>' });
    }
    const badge = (cls, text) => `<span class="badge ${cls}">${text}</span>`;
    switch (r.relation) {
      case 'inside': {
        let msg = r.role ? `Inside ${d.cidr}: ${r.role}.` : `${r.o.cidr} is entirely inside ${d.cidr}.`;
        if (!el.splitPanel.hidden && r.other.prefix >= splitPrefix) {
          const i = (r.o.network - d.network) >> BigInt(d.bits - splitPrefix);
          msg += ` In subnet #${fmt(i + 1n)} of the split (${addr(d, d.network + (i << BigInt(d.bits - splitPrefix)))}/${splitPrefix}).`;
        }
        return kvRow(t, msg, { plain: true, copy: false, badge: badge('badge-ok', 'Inside') });
      }
      case 'contains':
        return kvRow(t, `${r.o.cidr} contains all of ${d.cidr}.`, { plain: true, copy: false, badge: badge('badge-warn', 'Larger') });
      case 'other-version':
        return kvRow(t, `This is IPv${r.other.version}; the network is IPv${d.version}.`, { plain: true, copy: false, badge: badge('', 'Other family') });
      default:
        return kvRow(t, r.other.prefix === r.other.bits ? `Outside ${d.cidr}.` : `${r.o.cidr} is outside ${d.cidr}.`, { plain: true, copy: false, badge: badge('badge-warn', 'Outside') });
    }
  }).join('');
}

// ---------- reference tables ----------

function renderRef4() {
  const cur = net && net.version === 4 ? net.prefix : -1;
  el.ref4.innerHTML = Array.from({ length: 33 }, (_, p) => {
    const mask = maskOf(32, p);
    const size = 1n << BigInt(32 - p);
    const usable = p <= 30 ? size - 2n : p === 31 ? 2n : 1n;
    return `<tr${p === cur ? ' class="is-current"' : ''}>
      <td><button class="link" type="button" data-prefix="${p}" ${net && net.version === 4 ? '' : 'disabled'}>/${p}</button></td>
      <td>${formatAddress(4, mask)}</td><td>${formatAddress(4, mask ^ 0xffffffffn)}</td>
      <td>${fmt(size)}</td><td>${fmt(usable)}</td></tr>`;
  }).join('');
}

const REF6 = [
  [32, 'The usual minimum allocation to an ISP or large organisation'],
  [48, 'One site. The usual business allocation, and the size to pick from fd00::/8 for a private ULA prefix'],
  [56, 'A common delegation to a home connection'],
  [60, 'A smaller home delegation some ISPs hand out'],
  [64, 'One LAN or VLAN. SLAAC and most IPv6 features need exactly a /64'],
  [127, 'A point-to-point link between two routers (RFC 6164)'],
  [128, 'A single address: loopback, a host route'],
];
el.ref6.innerHTML = REF6.map(([p, use]) => `<tr><td>/${p}</td><td class="is-plain">${escapeHTML(use)}</td><td>${p <= 64 ? count(64 - p) : '—'}</td></tr>`).join('');

// ---------- wiring ----------

const update = debounce(() => { render(); persist(); }, 80);
el.input.addEventListener('input', update);
el.prefix.addEventListener('input', () => setPrefix(Number(el.prefix.value)));
el.splitPrefix.addEventListener('change', () => { splitPrefix = Number(el.splitPrefix.value); renderSplit(); renderCheck(); persist(); });
el.splitCopy.addEventListener('click', copySplit);
el.check.addEventListener('input', debounce(() => { renderCheck(); persist(); }, 80));
el.ref4.addEventListener('click', (e) => {
  const b = e.target.closest('[data-prefix]');
  if (!b) return;
  setPrefix(Number(b.dataset.prefix));
  el.input.scrollIntoView({ block: 'center', behavior: 'smooth' });
  toast(`Prefix set to /${b.dataset.prefix}`);
});

function readHash() {
  try { return decodeURI(location.hash.slice(1)); } catch { return ''; } // malformed escapes
}
// Editing the address in the URL bar (or following a link) updates the page.
window.addEventListener('hashchange', () => {
  const h = readHash();
  if (h && h !== el.input.value.trim()) { el.input.value = h; render(); persist(); }
});

el.input.value = readHash() || saved.input || '192.168.1.0/24';
el.check.value = saved.check || '';
render();
