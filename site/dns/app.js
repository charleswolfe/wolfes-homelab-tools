import {
  RCODES, ALGORITHMS, normalizeName, reverseName, parseEndpoint, digText, answerKey, formatTtl,
} from '/lib/dns.js';
import { resolve, LookupError } from './resolve.js';
import { RESOLVERS, PUBLIC } from './resolvers.js';
import { $, storage, alertHTML, escapeHTML } from '/assets/ui.js';
import { icon } from '/assets/icons.js';

const QTYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'SRV', 'CAA', 'PTR', 'HTTPS', 'SVCB', 'DS', 'DNSKEY', 'TLSA', 'NAPTR', 'SSHFP'];
const COMMON = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'CAA'];
const RECENT_MAX = 8;
const DIGESTS = { 1: 'SHA-1', 2: 'SHA-256', 4: 'SHA-384' };

const el = {
  form: $('#form'),
  name: $('#name'),
  type: $('#type'),
  go: $('#go'),
  resolver: $('#resolver'),
  compare: $('#compare'),
  dnssec: $('#dnssec'),
  cd: $('#cd'),
  customField: $('#custom-field'),
  custom: $('#custom'),
  recent: $('#recent'),
  messages: $('#messages'),
  privacy: $('#privacy'),
  results: $('#results'),
  ref: $('#ref-rows'),
};

const saved = storage.get('dns', {});
let recent = Array.isArray(saved.recent) ? saved.recent : [];
let inflight = null;

el.type.innerHTML = `<option value="ALL">Common records</option>${QTYPES.map((t) => `<option>${t}</option>`).join('')}`;
el.resolver.innerHTML = RESOLVERS.map((r) => `<option value="${r.id}">${escapeHTML(r.name)}</option>`).join('');
el.type.value = QTYPES.includes(saved.type) || saved.type === 'ALL' ? saved.type : 'A';
el.resolver.value = RESOLVERS.some((r) => r.id === saved.resolver) ? saved.resolver : 'cloudflare';
el.custom.value = saved.custom ?? '';
el.compare.checked = !!saved.compare;
el.dnssec.checked = !!saved.dnssec;
el.cd.checked = !!saved.cd;
el.name.value = saved.name ?? '';

// #example.com/MX pre-fills the form; nothing is sent until Look up.
if (location.hash.length > 1) {
  const [n, t] = decodeURIComponent(location.hash.slice(1)).split('/');
  el.name.value = n;
  if (t && (QTYPES.includes(t.toUpperCase()) || t.toUpperCase() === 'ALL')) el.type.value = t.toUpperCase();
}

function persist() {
  storage.set('dns', {
    name: el.name.value, type: el.type.value, resolver: el.resolver.value, custom: el.custom.value,
    compare: el.compare.checked, dnssec: el.dnssec.checked, cd: el.cd.checked, recent,
  });
}

// The chosen resolver as { name, url }; throws if the custom URL is invalid.
function chosen() {
  const r = RESOLVERS.find((x) => x.id === el.resolver.value);
  if (r.id !== 'custom') return r;
  const url = parseEndpoint(el.custom.value);
  return { id: 'custom', name: new URL(url).host, url };
}

const hostOf = (r) => (r.url.startsWith('/') ? location.host : new URL(r.url).host);

function syncControls() {
  el.customField.hidden = el.resolver.value !== 'custom';
  const all = el.type.value === 'ALL';
  el.compare.disabled = all;
  el.compare.closest('label').title = all ? 'Pick one record type to compare resolvers' : '';
  let hosts;
  if (el.compare.checked && !all) {
    hosts = PUBLIC.map(hostOf);
    if (['self', 'custom'].includes(el.resolver.value)) {
      try { hosts.push(hostOf(chosen())); } catch { /* not valid yet */ }
    }
  } else {
    try { hosts = [hostOf(chosen())]; } catch { hosts = ['the resolver you enter']; }
  }
  el.privacy.innerHTML = `${icon('globe')}<span>Nothing is sent until you click Look up. Then your browser asks ${hosts.map((h) => `<span class="mono">${escapeHTML(h)}</span>`).join(', ')} directly, so ${hosts.length > 1 ? 'they see' : 'it sees'} your IP address and the name you look up.</span>`;
}

function renderRecent() {
  el.recent.hidden = !recent.length;
  el.recent.innerHTML = `<span class="recent-label">Recent</span>${recent.map((r, i) => `<button class="chip" type="button" data-recent="${i}"><span class="mono">${escapeHTML(r.name)}</span><span class="hint">${escapeHTML(r.type === 'ALL' ? 'common' : r.type)}</span></button>`).join('')}`;
}

// ---------- record notes ----------

function note(rr) {
  const f = rr.fields;
  switch (rr.type) {
    case 'TXT': {
      const t = f.text ?? '';
      if (/^v=spf1\b/i.test(t)) return 'SPF: which servers may send mail for this domain';
      if (/^v=DMARC1\b/i.test(t)) return 'DMARC: what receivers do with mail that fails SPF/DKIM';
      if (/^v=DKIM1\b/i.test(t)) return 'DKIM public key';
      if (/^v=STSv1\b/i.test(t)) return 'MTA-STS policy ID';
      if (/-(?:site|domain)-verification=|verification=/i.test(t)) return 'Ownership verification token';
      return '';
    }
    case 'CAA':
      if (f.tag === 'issue') return f.value ? `${f.value} may issue certificates` : 'No CA may issue certificates';
      if (f.tag === 'issuewild') return f.value ? `${f.value} may issue wildcard certificates` : 'No CA may issue wildcard certificates';
      if (f.tag === 'iodef') return 'Where CAs report policy violations';
      return '';
    case 'MX': return f.host === '.' ? 'Null MX: this domain accepts no mail' : '';
    case 'SOA': return `primary ${f.mname} · contact ${f.rname.replace(/\.$/, '').replace(/(?<!\\)\./, '@')} · serial ${f.serial} · negative TTL ${formatTtl(f.minimum)}`;
    case 'SRV': return `${f.target} port ${f.port}, priority ${f.priority}, weight ${f.weight}`;
    case 'DNSKEY': case 'CDNSKEY':
      return `${f.role === 'KSK' ? 'Key-signing key' : 'Zone-signing key'} · key tag ${f.keyTag} · ${ALGORITHMS[f.algorithm] ?? `algorithm ${f.algorithm}`}`;
    case 'DS': case 'CDS':
      return `Key tag ${f.keyTag} · ${ALGORITHMS[f.algorithm] ?? `algorithm ${f.algorithm}`} · ${DIGESTS[f.digestType] ?? `digest ${f.digestType}`}`;
    case 'RRSIG': {
      const exp = new Date(f.expiration * 1000);
      return `Signs ${f.covered} · key tag ${f.keyTag} · expires ${exp.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
    }
    default: return '';
  }
}

function sortRecords(list) {
  return [...list].sort((a, b) => {
    if (a.type !== b.type) return 0;
    if (a.type === 'MX') return a.fields.preference - b.fields.preference;
    if (a.type === 'SRV') return a.fields.priority - b.fields.priority || b.fields.weight - a.fields.weight;
    return 0;
  });
}

function recordRows(list, qname) {
  return sortRecords(list).map((rr) => {
    const n = note(rr);
    const own = rr.name === qname;
    return `<tr>
      <td class="dns-name${own ? ' is-muted' : ''}">${escapeHTML(rr.name)}</td>
      <td class="num dns-ttl" title="${rr.ttl} seconds">${escapeHTML(formatTtl(rr.ttl))}</td>
      <td class="num dns-type"><span class="badge">${escapeHTML(rr.type)}</span></td>
      <td class="dns-value"><div class="dns-data">${escapeHTML(rr.data)}</div>${n ? `<div class="hint dns-note">${escapeHTML(n)}</div>` : ''}</td>
      <td class="num dns-copy"><button class="btn btn-ghost btn-icon" type="button" data-copy="${escapeHTML(rr.type === 'TXT' && rr.fields.text != null ? rr.fields.text : rr.data)}" aria-label="Copy value" title="Copy">${icon('copy')}</button></td>
    </tr>`;
  }).join('');
}

const table = (rows) => `<div class="table-wrap"><table class="table dns-table">
  <thead><tr><th>Name</th><th>TTL</th><th>Type</th><th>Value</th><th><span class="visually-hidden">Copy</span></th></tr></thead>
  <tbody>${rows}</tbody></table></div>`;

function statusBadge(msg) {
  const kind = msg.rcode === 0 ? 'ok' : msg.rcode === 3 ? 'warn' : 'danger';
  return `<span class="badge badge-${kind}" title="${escapeHTML(RCODES[msg.rcode]?.[1] ?? '')}">${escapeHTML(msg.rcodeName)}</span>`;
}

function dnssecBadge(msg) {
  if (msg.flags.ad) return `<span class="badge badge-ok" title="The resolver validated the DNSSEC signatures (AD flag)">${icon('shield')}DNSSEC</span>`;
  if (msg.flags.cd) return '<span class="badge" title="Validation skipped (CD flag)">Not validated</span>';
  return '<span class="badge" title="The zone isn’t signed, or this resolver doesn’t validate (no AD flag)">Unsigned</span>';
}

// One record type from one resolver.
function resultPanel(qname, type, resolver, res) {
  const { msg, ms, size } = res;
  const answers = msg.answer.filter((rr) => el.dnssec.checked || rr.type !== 'RRSIG');
  const authority = msg.authority.filter((rr) => el.dnssec.checked || !['RRSIG', 'NSEC', 'NSEC3'].includes(rr.type));
  const notes = [];
  if (msg.rcode === 3) notes.push(alertHTML('warn', `${qname} doesn’t exist (NXDOMAIN).`));
  else if (msg.rcode !== 0) notes.push(alertHTML('error', `${msg.rcodeName}: ${RCODES[msg.rcode]?.[1] ?? 'The resolver returned an error.'}`));
  else if (!answers.length) notes.push(alertHTML('info', `The name exists but has no ${type} records.`));
  for (const e of msg.edns?.errors ?? []) notes.push(alertHTML(e.code === 15 || e.code === 16 || e.code === 17 ? 'warn' : 'info', `Resolver says: ${e.name}${e.text ? `, “${e.text}”` : ''}.`));
  if (msg.flags.tc) notes.push(alertHTML('warn', 'The answer was truncated (TC flag), so some records may be missing.'));
  const dig = digText(msg, { server: resolver.url, ms, size });
  return `<section class="panel">
    <div class="panel-head">
      <h2>${escapeHTML(type)} <span class="hint mono">${escapeHTML(qname)}</span></h2>
      ${statusBadge(msg)}${msg.rcode === 0 ? dnssecBadge(msg) : ''}
      <span class="hint">${escapeHTML(resolver.name)} · ${Math.round(ms)} ms</span>
    </div>
    ${notes.length ? `<div class="panel-body messages">${notes.join('')}</div>` : ''}
    ${answers.length ? table(recordRows(answers, qname)) : ''}
    ${!answers.length && authority.length ? `<div class="panel-body"><span class="hint">Authority section (the zone that answered):</span></div>${table(recordRows(authority, qname))}` : ''}
    <details class="cheatsheet">
      <summary><span data-icon="chevronRight"></span>Raw response (dig format)</summary>
      <div class="panel-body stack-sm">
        <div><button class="btn" type="button" data-copy="${escapeHTML(dig)}">${icon('copy')}Copy</button></div>
        <pre class="code-block">${escapeHTML(dig)}</pre>
      </div>
    </details>
  </section>`;
}

const errorPanel = (type, resolver, err) => `<section class="panel">
  <div class="panel-head"><h2>${escapeHTML(type)}</h2><span class="hint">${escapeHTML(resolver.name)}</span></div>
  <div class="panel-body messages">${alertHTML('error', err.message)}</div>
</section>`;

// The same question to several resolvers, side by side.
function comparePanel(qname, type, rows) {
  const keys = [];
  for (const r of rows) {
    if (!r.res) continue;
    r.key = answerKey(r.res.msg);
    if (!keys.includes(r.key)) keys.push(r.key);
  }
  const ok = rows.filter((r) => r.res).length;
  const summary = !ok ? alertHTML('error', 'No resolver answered.')
    : keys.length === 1 ? alertHTML('ok', `All ${ok} resolvers that answered agree.`)
      : alertHTML('warn', `${keys.length} different answers. A recent change may still be spreading (wait out the old TTL), or resolvers filter or locate differently.`);
  const body = rows.map((r) => {
    if (!r.res) return `<tr><td class="is-plain">${escapeHTML(r.resolver.name)}</td><td colspan="4" class="is-plain">${alertHTML('error', r.err.message)}</td></tr>`;
    const { msg, ms } = r.res;
    const recs = sortRecords(msg.answer.filter((rr) => rr.type !== 'RRSIG'));
    const group = keys.length > 1 ? `<span class="badge badge-accent dns-group">${keys.indexOf(r.key) + 1}</span>` : '';
    const ttl = recs.length ? formatTtl(Math.min(...recs.map((rr) => rr.ttl))) : '';
    return `<tr>
      <td class="is-plain dns-name">${group}${escapeHTML(r.resolver.name)}</td>
      <td class="dns-type">${statusBadge(msg)}</td>
      <td class="dns-value">${recs.length ? recs.map((rr) => `<div class="dns-data">${rr.type !== type ? `<span class="hint">${escapeHTML(rr.type)}</span> ` : ''}${escapeHTML(rr.data)}</div>`).join('') : '<span class="hint">No records</span>'}</td>
      <td class="num dns-ttl">${escapeHTML(ttl)}</td>
      <td class="num dns-copy">${dnssecBadge(msg)} <span class="hint">${Math.round(ms)} ms</span></td>
    </tr>`;
  }).join('');
  return `<section class="panel">
    <div class="panel-head"><h2>${escapeHTML(type)} <span class="hint mono">${escapeHTML(qname)}</span></h2><span class="hint">${rows.length} resolvers</span></div>
    <div class="panel-body messages">${summary}</div>
    <div class="table-wrap"><table class="table dns-table">
      <thead><tr><th>Resolver</th><th>Status</th><th>Answer</th><th>TTL</th><th>DNSSEC · time</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
  </section>`;
}

// ---------- lookup ----------

async function lookup() {
  el.messages.innerHTML = '';
  const raw = el.name.value.trim();
  if (!raw) {
    el.messages.innerHTML = alertHTML('info', 'Enter a domain name or an IP address.');
    return;
  }
  let qname;
  let type = el.type.value;
  let resolver;
  const notes = [];
  try {
    const rev = reverseName(raw);
    if (rev) {
      qname = rev;
      if (type !== 'PTR') notes.push(`${raw} is an IP address, so this looks up its reverse name (PTR) ${rev}.`);
      type = 'PTR';
    } else {
      qname = normalizeName(raw);
      if (qname !== raw.replace(/\.$/, '') && /[^\x21-\x7e]/.test(raw)) notes.push(`International name, sent as ${qname}.`);
    }
    resolver = chosen();
  } catch (err) {
    el.messages.innerHTML = alertHTML('error', err.message);
    return;
  }
  el.messages.innerHTML = notes.map((n) => alertHTML('info', n)).join('');
  const shown = (qname || '.').replace(/\.?$/, '.');

  recent = [{ name: raw, type: el.type.value }, ...recent.filter((r) => !(r.name === raw && r.type === el.type.value))].slice(0, RECENT_MAX);
  renderRecent();
  persist();
  history.replaceState(null, '', '#' + encodeURIComponent(raw) + '/' + el.type.value);

  inflight?.abort();
  const ctrl = new AbortController();
  inflight = ctrl;
  const opts = { dnssec: el.dnssec.checked, cd: el.cd.checked, signal: ctrl.signal };
  const run = (r, t) => resolve(r.url, qname, t, opts).then((res) => ({ resolver: r, res }), (err) => ({ resolver: r, err }));
  el.go.disabled = true;
  el.go.classList.add('is-busy');
  el.results.setAttribute('aria-busy', 'true');
  try {
    let html;
    if (el.compare.checked && type !== 'ALL') {
      const list = [...PUBLIC];
      if (['self', 'custom'].includes(resolver.id)) list.push(resolver);
      const rows = await Promise.all(list.map((r) => run(r, type)));
      if (ctrl.signal.aborted) return;
      html = comparePanel(shown, type, rows);
    } else {
      const types = type === 'ALL' ? COMMON : [type];
      const rows = await Promise.all(types.map((t) => run(resolver, t).then((r) => ({ ...r, type: t }))));
      if (ctrl.signal.aborted) return;
      const nx = rows.find((r) => r.res?.msg.rcode === 3);
      if (rows.length > 1 && rows.every((r) => r.err)) {
        html = errorPanel('Lookup failed', resolver, rows[0].err);
      } else if (type === 'ALL' && nx) {
        html = resultPanel(shown, nx.type, resolver, nx.res);
      } else {
        // "Common records" leaves out the types with nothing to show.
        const has = (r) => r.err || r.res.msg.rcode !== 0 || r.res.msg.answer.some((rr) => rr.type !== 'RRSIG');
        const visible = type === 'ALL' ? rows.filter(has) : rows;
        html = visible.map((r) => (r.err ? errorPanel(r.type, resolver, r.err) : resultPanel(shown, r.type, resolver, r.res))).join('');
        const empty = rows.filter((r) => !visible.includes(r)).map((r) => r.type);
        if (empty.length) html += `<p class="hint dns-empty">No ${empty.join(', ')} records.</p>`;
      }
    }
    el.results.innerHTML = html;
  } catch (err) {
    if (!(err instanceof LookupError) && err.name !== 'AbortError') el.results.innerHTML = errorPanel(type, resolver, err);
  } finally {
    if (inflight === ctrl) {
      inflight = null;
      el.go.disabled = false;
      el.go.classList.remove('is-busy');
      el.results.removeAttribute('aria-busy');
    }
  }
}

// ---------- reference ----------

el.ref.innerHTML = [
  ...Object.values(RCODES).map(([n, d]) => [n, d]),
  ['AD flag', 'Authenticated data: the resolver checked the DNSSEC signatures and they’re valid.'],
  ['CD flag', 'Checking disabled: you asked the resolver not to validate (“Skip validation”).'],
  ['TC flag', 'Truncated: the answer didn’t fit, so some records are missing.'],
  ['NODATA', 'Not a code: NOERROR with no records means the name exists but has no records of that type.'],
].map(([c, d]) => `<tr><td>${escapeHTML(c)}</td><td class="is-plain">${escapeHTML(d)}</td></tr>`).join('');

// ---------- events ----------

el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  lookup();
});
el.recent.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-recent]');
  if (!chip) return;
  const r = recent[Number(chip.dataset.recent)];
  el.name.value = r.name;
  el.type.value = r.type;
  syncControls();
  lookup();
});
for (const c of [el.type, el.resolver, el.compare, el.dnssec, el.cd, el.custom]) {
  c.addEventListener(c === el.custom ? 'input' : 'change', () => {
    syncControls();
    persist();
  });
}
el.name.addEventListener('input', persist);

syncControls();
renderRecent();
