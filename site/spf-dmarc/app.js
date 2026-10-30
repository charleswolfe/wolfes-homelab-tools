import {
  detectKind, unquote, parseSpf, checkSpf, parseDmarc, parseDkim, dmarcParents, externalReportChecks, verdict,
  COMMON_SELECTORS, SPF_LOOKUP_LIMIT,
} from '/lib/email-auth.js';
import { normalizeName, parseEndpoint } from '/lib/dns.js';
import { resolve } from '/dns/resolve.js';
import { RESOLVERS } from '/dns/resolvers.js';
import { $, $$, storage, debounce, alertHTML, escapeHTML } from '/assets/ui.js';
import { icon } from '/assets/icons.js';

const el = {
  modes: $$('input[name="mode"]'),
  lookupForm: $('#lookup-form'),
  pasteForm: $('#paste-form'),
  domain: $('#domain'),
  selector: $('#selector'),
  resolver: $('#resolver'),
  customField: $('#custom-field'),
  custom: $('#custom'),
  go: $('#go'),
  record: $('#record'),
  detected: $('#detected'),
  messages: $('#messages'),
  privacy: $('#privacy'),
  results: $('#results'),
};

const saved = storage.get('spf-dmarc', {});
el.resolver.innerHTML = RESOLVERS.map((r) => `<option value="${r.id}">${escapeHTML(r.name)}</option>`).join('');
el.resolver.value = RESOLVERS.some((r) => r.id === saved.resolver) ? saved.resolver : 'cloudflare';
el.custom.value = saved.custom ?? '';
el.domain.value = saved.domain ?? '';
el.selector.value = saved.selector ?? '';
el.record.value = saved.record ?? '';
const mode = () => el.modes.find((m) => m.checked).value;
for (const m of el.modes) m.checked = m.value === (saved.mode === 'paste' ? 'paste' : 'lookup');
if (location.hash.length > 1) {
  el.domain.value = decodeURIComponent(location.hash.slice(1));
  el.modes[0].checked = true;
}

let inflight = null;

function persist() {
  storage.set('spf-dmarc', {
    mode: mode(), domain: el.domain.value, selector: el.selector.value, resolver: el.resolver.value,
    custom: el.custom.value, record: el.record.value,
  });
}

function chosen() {
  const r = RESOLVERS.find((x) => x.id === el.resolver.value);
  if (r.id !== 'custom') return r;
  const url = parseEndpoint(el.custom.value);
  return { id: 'custom', name: new URL(url).host, url };
}

function syncControls() {
  const lookup = mode() === 'lookup';
  el.lookupForm.hidden = !lookup;
  el.pasteForm.hidden = lookup;
  el.customField.hidden = !lookup || el.resolver.value !== 'custom';
  let host;
  try {
    const r = chosen();
    host = r.url.startsWith('/') ? location.host : new URL(r.url).host;
  } catch {
    host = 'the resolver you enter';
  }
  el.privacy.innerHTML = lookup
    ? `${icon('globe')}<span>Nothing is sent until you click Check. Then your browser asks <span class="mono">${escapeHTML(host)}</span> for the domain’s TXT and MX records, so it sees your IP address and the domain.</span>`
    : `${icon('lock')}<span>Pasted records are checked in your browser; nothing is sent anywhere.</span>`;
}

// ---------- rendering ----------

const BADGE = { error: ['danger', 'Problems'], warn: ['warn', 'Warnings'], ok: ['ok', 'OK'], missing: ['danger', 'Missing'], info: ['', 'Not checked'] };
const verdictBadge = (v) => `<span class="badge${BADGE[v][0] ? ` badge-${BADGE[v][0]}` : ''}">${BADGE[v][1]}</span>`;
const LEVEL_ALERT = { error: 'error', warn: 'warn', info: 'info', ok: 'ok' };
const ORDER = { error: 0, warn: 1, info: 2, ok: 3 };
const findingsHTML = (list) => {
  const sorted = [...list].sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  return sorted.length ? `<div class="panel-body messages">${sorted.map((f) => alertHTML(LEVEL_ALERT[f.level], f.text)).join('')}</div>` : '';
};
// Only for looked-up records; a pasted record is already on screen.
const recordBlock = (name, record) => (!name ? '' : `<div class="panel-body stack-sm">
  <span class="hint">TXT at <span class="mono">${escapeHTML(name)}</span></span>
  <div class="ea-recordline"><pre class="code-block">${escapeHTML(record)}</pre>
  <button class="btn btn-ghost btn-icon" type="button" data-copy="${escapeHTML(record)}" aria-label="Copy record" title="Copy">${icon('copy')}</button></div>
</div>`);
const tagTable = (head, rows, cls = 'ea-table') => `<div class="table-wrap"><table class="table ${cls}">
  <thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;

function meter(used) {
  const pct = Math.min(100, (used / SPF_LOOKUP_LIMIT) * 100);
  const kind = used > SPF_LOOKUP_LIMIT ? 'danger' : used >= 8 ? 'warn' : 'ok';
  return `<div class="ea-meter is-${kind}" role="meter" aria-valuemin="0" aria-valuemax="${SPF_LOOKUP_LIMIT}" aria-valuenow="${used}" aria-label="DNS lookups">
    <div class="ea-meter-bar"><span data-pct="${pct}"></span></div>
    <span class="ea-meter-text"><strong>${used}</strong> of ${SPF_LOOKUP_LIMIT} DNS lookups</span>
  </div>`;
}

function spfTerms(parsed) {
  return tagTable(['Term', 'Meaning', 'Lookups'], parsed.terms.map((t) => `<tr${t.kind === 'invalid' || t.kind === 'ignored' ? ' class="is-bad"' : ''}>
    <td class="ea-k">${escapeHTML(t.raw)}</td><td class="is-plain ea-m">${escapeHTML(t.explain ?? '')}</td><td class="num">${t.lookups ? `<span class="ea-lookups">${t.lookups}</span>` : ''}</td></tr>`).join(''));
}

function treeHTML(node) {
  // Lookups a node causes: its own terms plus everything inside its includes.
  // An include's own lookup is counted in its parent's terms, so a child
  // shows 1 + its total.
  const total = (n) => (n.parsed?.lookups ?? 0) + (n.children ?? []).reduce((s, c) => s + total(c), 0);
  const count = (n) => (n.via === 'root' ? total(n) : 1 + total(n));
  const item = (n) => `<li>
    <div class="ea-tree-head"><span class="mono">${escapeHTML(n.via === 'root' ? n.domain : `${n.via === 'redirect' ? 'redirect=' : 'include:'}${n.domain}`)}</span>
    <span class="hint">${count(n)} lookup${count(n) === 1 ? '' : 's'}</span></div>
    ${n.record ? `<div class="ea-tree-record mono">${escapeHTML(n.record)}</div>` : ''}
    ${n.error ? `<div class="ea-tree-error">${icon('alert')}${escapeHTML(n.error)}</div>` : ''}
    ${n.children?.length ? `<ul>${n.children.map(item).join('')}</ul>` : ''}
  </li>`;
  return `<ul class="ea-tree">${item(node)}</ul>`;
}

function spfPanel(domain, res) {
  const { root } = res;
  if (!root.record) {
    return { v: 'missing', html: `<section class="panel"><div class="panel-head"><h2>SPF</h2>${verdictBadge('missing')}</div>
      ${findingsHTML([...res.findings, { level: 'info', text: `Add a TXT record at ${domain} such as “v=spf1 mx ~all”, listing every service that sends mail as this domain. If the domain sends no mail at all, publish “v=spf1 -all”.` }])}</section>` };
  }
  const findings = [...res.findings, ...root.parsed.findings.filter((f) => !(f.level === 'error' && /DNS lookups in this record alone/.test(f.text)))];
  const v = verdict(findings);
  const ipList = res.ips.length ? `<details class="cheatsheet"><summary><span data-icon="chevronRight"></span>Allowed address ranges (${res.ips.length})</summary>
    ${tagTable(['Range', 'Result', 'From'], res.ips.map((ip) => `<tr><td>${escapeHTML(ip.value)}</td><td class="is-plain">${escapeHTML(ip.result)}</td><td>${escapeHTML(ip.from)}</td></tr>`).join(''), 'nowrap')}</details>` : '';
  return { v, html: `<section class="panel">
    <div class="panel-head"><h2>SPF</h2>${verdictBadge(v)}</div>
    ${recordBlock(domain, root.record)}
    <div class="panel-body">${meter(res.lookups)}</div>
    ${findingsHTML(findings)}
    ${spfTerms(root.parsed)}
    ${root.children.length ? `<details class="cheatsheet" open><summary><span data-icon="chevronRight"></span>Includes, followed</summary><div class="panel-body">${treeHTML(root)}</div></details>` : ''}
    ${ipList}
  </section>` };
}

function dmarcPanel(found, parsed, extra = []) {
  if (!parsed) {
    return { v: 'missing', html: `<section class="panel"><div class="panel-head"><h2>DMARC</h2>${verdictBadge('missing')}</div>
      ${findingsHTML([{ level: 'error', text: `No DMARC record at ${found}. Receivers apply no policy, and you get no reports.` },
        { level: 'info', text: `Start with a TXT record at ${found}: “v=DMARC1; p=none; rua=mailto:dmarc-reports@${found.replace(/^_dmarc\./, '')}”.` }])}</section>` };
  }
  const findings = [...parsed.findings, ...extra];
  const v = verdict(findings);
  return { v, html: `<section class="panel">
    <div class="panel-head"><h2>DMARC</h2>${verdictBadge(v)}</div>
    ${recordBlock(found, parsed.record)}
    ${parsed.summary ? `<div class="panel-body"><div class="ea-summary">${escapeHTML(parsed.summary)}</div></div>` : ''}
    ${findingsHTML(findings)}
    ${tagTable(['Tag', 'Value', 'Meaning'], parsed.tags.map((t) => `<tr${t.valid ? '' : ' class="is-bad"'}><td class="ea-k">${escapeHTML(t.name)}</td><td class="ea-v">${escapeHTML(t.value)}</td><td class="is-plain ea-m">${escapeHTML(t.explain)}</td></tr>`).join(''))}
  </section>` };
}

function dkimPanel(list, tried) {
  if (!list.length) {
    const text = tried.length === 1
      ? `No DKIM key at ${tried[0]}._domainkey. Check the selector: it’s the s= value in a message’s DKIM-Signature header.`
      : `No DKIM key at the ${tried.length} common selectors tried. That doesn’t mean there’s none: enter the selector from the s= value in a message’s DKIM-Signature header.`;
    return { v: 'info', html: `<section class="panel"><div class="panel-head"><h2>DKIM</h2>${verdictBadge('info')}</div>${findingsHTML([{ level: 'info', text }])}</section>` };
  }
  const all = list.flatMap((k) => k.parsed.findings);
  const v = verdict(all);
  return { v, html: list.map((k) => {
    const kv = verdict(k.parsed.findings);
    return `<section class="panel">
      <div class="panel-head"><h2>DKIM <span class="hint mono">${escapeHTML(k.selector)}</span></h2>${verdictBadge(kv)}
        <span class="hint">${escapeHTML(k.parsed.keyType.toUpperCase())}${k.parsed.keyBits ? ` · ${k.parsed.keyBits} bits` : ''}</span></div>
      ${recordBlock(k.name, k.parsed.record)}
      ${findingsHTML(k.parsed.findings)}
      ${tagTable(['Tag', 'Meaning'], k.parsed.tags.filter((t) => t.name !== 'p').map((t) => `<tr><td class="ea-k">${escapeHTML(`${t.name}=${t.value}`)}</td><td class="is-plain ea-m">${escapeHTML(t.explain)}</td></tr>`).join(''))}
    </section>`;
  }).join('') };
}

function summaryCards(parts) {
  return `<section class="panel"><div class="panel-body ea-cards">${parts.map(([name, v, note]) => `<div class="mini-card">
    <div class="mini-card-head">${escapeHTML(name)}${verdictBadge(v)}</div>
    <div class="hint">${escapeHTML(note)}</div></div>`).join('')}</div></section>`;
}

// CSP blocks inline style attributes, so bar widths are set through CSSOM.
function applyBars() {
  for (const s of $$('.ea-meter-bar span', el.results)) s.style.setProperty('width', `${s.dataset.pct}%`);
}

// ---------- lookup mode ----------

async function lookup() {
  el.messages.innerHTML = '';
  let domain;
  let resolver;
  try {
    if (!el.domain.value.trim()) throw new Error('Enter a domain, like example.com.');
    domain = normalizeName(el.domain.value.trim().replace(/^.*@/, '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '')).toLowerCase();
    resolver = chosen();
  } catch (err) {
    el.messages.innerHTML = alertHTML('error', err.message);
    return;
  }
  const selector = el.selector.value.trim().replace(/\._domainkey.*$/i, '');
  if (selector && !/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/.test(selector)) {
    el.messages.innerHTML = alertHTML('error', `“${selector}” isn’t a valid DKIM selector.`);
    return;
  }
  persist();
  history.replaceState(null, '', '#' + encodeURIComponent(domain));

  inflight?.abort();
  const ctrl = new AbortController();
  inflight = ctrl;
  const cache = new Map();
  const query = (name, type) => {
    const key = `${type} ${name}`;
    if (!cache.has(key)) cache.set(key, resolve(resolver.url, name, type, { signal: ctrl.signal }).then(({ msg }) => msg));
    return cache.get(key);
  };
  const getTxt = async (name) => {
    const msg = await query(name, 'TXT');
    if (msg.rcode !== 0 && msg.rcode !== 3) throw new Error(`${name}: the resolver answered ${msg.rcodeName}.`);
    return { rcode: msg.rcode, texts: msg.answer.filter((r) => r.type === 'TXT').map((r) => r.fields.text) };
  };
  const getMx = async (name) => {
    const msg = await query(name, 'MX');
    return { rcode: msg.rcode, hosts: msg.answer.filter((r) => r.type === 'MX').map((r) => r.fields.host) };
  };

  el.go.disabled = true;
  el.go.classList.add('is-busy');
  el.results.setAttribute('aria-busy', 'true');
  try {
    // Fails fast (and clearly) if the resolver can't be reached at all.
    const apex = await getTxt(domain);
    const [spf, dmarc, dkim] = await Promise.all([
      checkSpf(domain, { getTxt, getMx }),
      findDmarc(domain, getTxt),
      findDkim(domain, selector, getTxt),
    ]);
    if (ctrl.signal.aborted) return;
    const notes = [];
    if (apex.rcode === 3) notes.push(alertHTML('warn', `${domain} doesn’t exist (NXDOMAIN).`));
    el.messages.innerHTML = notes.join('');
    const s = spfPanel(domain, spf);
    const d = dmarcPanel(dmarc.name, dmarc.parsed, dmarc.extra);
    const k = dkimPanel(dkim.found, dkim.tried);
    el.results.innerHTML = summaryCards([
      ['SPF', s.v, spf.root.record ? `${spf.lookups} of ${SPF_LOOKUP_LIMIT} lookups` : 'No record'],
      ['DMARC', d.v, dmarc.parsed ? `p=${dmarc.parsed.policy ?? '?'}${dmarc.inherited ? ` (from ${dmarc.name.replace(/^_dmarc\./, '')})` : ''}` : 'No record'],
      ['DKIM', k.v, dkim.found.length ? dkim.found.map((x) => x.selector).join(', ') : selector ? 'Not found' : 'No common selector found'],
    ]) + s.html + d.html + k.html;
    applyBars();
  } catch (err) {
    if (err.name !== 'AbortError') el.results.innerHTML = `<section class="panel"><div class="panel-body messages">${alertHTML('error', err.message)}</div></section>`;
  } finally {
    if (inflight === ctrl) {
      inflight = null;
      el.go.disabled = false;
      el.go.classList.remove('is-busy');
      el.results.removeAttribute('aria-busy');
    }
  }
}

async function findDmarc(domain, getTxt) {
  const pick = (texts) => texts.filter((t) => /^v\s*=\s*DMARC1\s*(;|$)/i.test(t));
  for (const [i, d] of [domain, ...dmarcParents(domain)].entries()) {
    const name = `_dmarc.${d}`;
    const r = await getTxt(name);
    const recs = pick(r.texts);
    if (!recs.length) continue;
    const parsed = parseDmarc(recs[0]);
    const extra = [];
    if (recs.length > 1) extra.push({ level: 'error', text: `${name} has ${recs.length} DMARC records; receivers ignore all of them.` });
    if (i > 0) extra.push({ level: 'info', text: `${domain} has no DMARC record of its own, so the parent’s applies${parsed.values.sp ? `, with sp=${parsed.values.sp}` : ''}.` });
    for (const ext of externalReportChecks(d, parsed)) {
      try {
        const auth = await getTxt(ext.name);
        if (!pick(auth.texts).length) extra.push({ level: 'warn', text: `Reports go to ${ext.domain}, which hasn’t authorised them (no “v=DMARC1” TXT at ${ext.name}), so receivers won’t send them.` });
      } catch { /* leave unchecked */ }
    }
    return { name, parsed, extra, inherited: i > 0 };
  }
  return { name: `_dmarc.${domain}`, parsed: null, extra: [] };
}

async function findDkim(domain, selector, getTxt) {
  const tried = selector ? [selector] : COMMON_SELECTORS;
  const found = [];
  await Promise.all(tried.map(async (sel) => {
    const name = `${sel}._domainkey.${domain}`;
    try {
      const r = await getTxt(name);
      const rec = r.texts.find((t) => detectKind(t) === 'dkim') ?? (selector ? r.texts[0] : null);
      if (rec) found.push({ selector: sel, name, parsed: parseDkim(rec) });
    } catch { /* not found or unreachable */ }
  }));
  found.sort((a, b) => tried.indexOf(a.selector) - tried.indexOf(b.selector));
  return { found, tried };
}

// ---------- paste mode ----------

function checkPasted() {
  const text = el.record.value.trim();
  el.messages.innerHTML = '';
  if (!text) {
    el.detected.textContent = 'Paste an SPF, DMARC or DKIM record, with or without quotes.';
    el.results.innerHTML = '';
    return;
  }
  // A malformed "v=spf…" still goes to the SPF parser, which explains the problem.
  const kind = detectKind(unquote(text)) ?? (/^v=spf/i.test(unquote(text)) ? 'spf' : null);
  if (!kind) {
    el.detected.textContent = '';
    el.results.innerHTML = '';
    el.messages.innerHTML = alertHTML('info', 'This doesn’t look like an SPF (v=spf1), DMARC (v=DMARC1) or DKIM (v=DKIM1; p=…) record.');
    return;
  }
  el.detected.textContent = { spf: 'Detected an SPF record.', dmarc: 'Detected a DMARC record.', dkim: 'Detected a DKIM key record.' }[kind];
  if (kind === 'spf') {
    const parsed = parseSpf(text);
    const findings = [...parsed.findings];
    if (parsed.terms.some((t) => t.name === 'include' || t.name === 'redirect')) {
      findings.push({ level: 'info', text: 'This count covers this record only. Includes add their own lookups; look up the domain to count them all.' });
    }
    const v = verdict(findings);
    el.results.innerHTML = `<section class="panel"><div class="panel-head"><h2>SPF</h2>${verdictBadge(v)}</div>
      <div class="panel-body">${meter(parsed.lookups)}</div>${findingsHTML(findings)}${spfTerms(parsed)}</section>`;
    applyBars();
  } else if (kind === 'dmarc') {
    const parsed = parseDmarc(text);
    el.results.innerHTML = dmarcPanel('', parsed).html;
  } else {
    el.results.innerHTML = dkimPanel([{ selector: '', name: '', parsed: parseDkim(text) }], []).html;
  }
}

// ---------- events ----------

el.lookupForm.addEventListener('submit', (e) => {
  e.preventDefault();
  lookup();
});
for (const m of el.modes) {
  m.addEventListener('change', () => {
    inflight?.abort();
    el.results.innerHTML = '';
    el.messages.innerHTML = '';
    syncControls();
    persist();
    if (mode() === 'paste') checkPasted();
  });
}
el.record.addEventListener('input', debounce(() => { checkPasted(); persist(); }, 120));
for (const c of [el.resolver, el.custom]) c.addEventListener(c === el.custom ? 'input' : 'change', () => { syncControls(); persist(); });
for (const c of [el.domain, el.selector]) c.addEventListener('input', persist);

syncControls();
if (mode() === 'paste') checkPasted();
