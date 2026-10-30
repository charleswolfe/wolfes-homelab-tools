// SPF (RFC 7208), DMARC (RFC 7489, plus DMARCbis tags) and DKIM key
// (RFC 6376) record parsers and checks. No DOM and no network: the lookup
// checks take a `getTxt(name)` function so the page decides how to query.
import { parseIPv4, parseIPv6 } from './subnet.js';

// Each finding: { level: 'error' | 'warn' | 'info' | 'ok', text }.
const finding = (level, text) => ({ level, text });

export function detectKind(text) {
  const t = String(text).trim().replace(/^"|"$/g, '');
  if (/^v=spf1(\s|$)/i.test(t)) return 'spf';
  if (/^v\s*=\s*DMARC1\s*(;|$)/i.test(t)) return 'dmarc';
  if (/^v\s*=\s*DKIM1\s*(;|$)/i.test(t) || /(^|;)\s*p\s*=\s*[A-Za-z0-9+/]{40,}/.test(t)) return 'dkim';
  return null;
}

// TXT data as pasted from a zone file or dig: "part one" "part two" → joined.
export function unquote(text) {
  const t = String(text).trim();
  const parts = [...t.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
  return parts.length && t.startsWith('"') ? parts.join('') : t;
}

// ---------- SPF ----------

const QUALIFIERS = { '+': 'pass', '-': 'fail', '~': 'softfail', '?': 'neutral' };
const QUALIFIER_TEXT = {
  '+': 'Allowed',
  '-': 'Rejected (fail)',
  '~': 'Marked suspicious (softfail)',
  '?': 'No opinion (neutral)',
};
const LOOKUP_MECHANISMS = new Set(['include', 'a', 'mx', 'ptr', 'exists']);
export const SPF_LOOKUP_LIMIT = 10;
export const SPF_VOID_LIMIT = 2;

const hasMacro = (s) => s.includes('%');

function validDomainSpec(s) {
  if (hasMacro(s)) return /^[\x21-\x7e]+$/.test(s);
  return /^(?=.{1,253}$)([A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9-]{2,63}\.?$/.test(s);
}

function parseCidrs(s, term) {
  const m = /^(.*?)(?:\/(\d+))?(?:\/\/(\d+))?$/.exec(s);
  const out = { target: m[1], cidr4: m[2] === undefined ? null : Number(m[2]), cidr6: m[3] === undefined ? null : Number(m[3]) };
  if (out.cidr4 !== null && out.cidr4 > 32) throw new Error(`“${term}”: an IPv4 prefix can’t be longer than /32.`);
  if (out.cidr6 !== null && out.cidr6 > 128) throw new Error(`“${term}”: an IPv6 prefix can’t be longer than //128.`);
  return out;
}

function explainMechanism(t, domain) {
  const self = domain ? domain : 'this domain';
  const target = t.target || self;
  switch (t.name) {
    case 'all': return {
      '-': 'Every other server: reject. The strictest ending.',
      '~': 'Every other server: accept but mark as suspicious. The usual ending while you check your senders.',
      '?': 'Every other server: no opinion, as if there were no SPF record.',
      '+': 'Every other server: allowed. This lets anyone send as this domain and defeats SPF.',
    }[t.qualifier];
    case 'include': return `Servers that ${t.target}’s SPF record allows.`;
    case 'a': return `The IP addresses of ${target}${t.cidr4 !== null || t.cidr6 !== null ? ` (widened to /${t.cidr4 ?? 32} and //${t.cidr6 ?? 128})` : ''}.`;
    case 'mx': return `The mail servers (MX hosts) of ${target}.`;
    case 'ip4': return `The IPv4 ${t.value.includes('/') ? 'range' : 'address'} ${t.value}.`;
    case 'ip6': return `The IPv6 ${t.value.includes('/') ? 'range' : 'address'} ${t.value}.`;
    case 'exists': return `Matches if ${t.target} has an A record. Usually built with macros, per message.`;
    case 'ptr': return `Servers whose reverse DNS name ends in ${target}. Deprecated: slow and unreliable.`;
    default: return '';
  }
}

// Parses one SPF record. `domain` (optional) only improves the wording.
export function parseSpf(text, domain = '') {
  const record = unquote(text);
  const findings = [];
  const terms = [];
  const res = { record, terms, findings, lookups: 0, all: null, redirect: null, exp: null, valid: true };
  const error = (msg) => { findings.push(finding('error', msg)); res.valid = false; };

  if (!/^v=spf1(\s|$)/i.test(record)) {
    error('An SPF record must start with “v=spf1”.');
    return res;
  }
  if (/[^\x20-\x7e]/.test(record)) error('The record contains characters other than printable ASCII (curly quotes or a non-breaking space?).');
  const raw = record.split(/ +/).slice(1).filter(Boolean);
  let afterAll = [];

  for (const term of raw) {
    if (res.all) { afterAll.push(term); continue; }
    const mod = /^([A-Za-z][A-Za-z0-9_.-]*)=(.*)$/.exec(term);
    if (mod) {
      const name = mod[1].toLowerCase();
      const value = mod[2];
      const t = { raw: term, kind: 'modifier', name, value, target: value, lookups: 0 };
      if (name === 'redirect' || name === 'exp') {
        if (res[name]) error(`“${name}=” appears more than once, which makes the record invalid (PermError).`);
        if (!validDomainSpec(value)) error(`“${term}” doesn’t name a valid domain.`);
        res[name] = value;
        if (name === 'redirect') {
          t.lookups = 1;
          t.explain = `If nothing above matched, use ${value}’s SPF record instead.`;
        } else {
          t.explain = `Where receivers find the text to show in rejections (${value}’s TXT record).`;
        }
      } else {
        t.explain = 'Unknown modifier; receivers ignore it.';
        findings.push(finding('warn', `Unknown modifier “${term}” is ignored by receivers. Check it isn’t a typo.`));
      }
      terms.push(t);
      continue;
    }
    const m = /^([+\-~?]?)([A-Za-z][A-Za-z0-9]*)(?::(.*)|(\/.*))?$/.exec(term);
    if (!m) {
      error(`“${term}” isn’t a valid SPF term.`);
      terms.push({ raw: term, kind: 'invalid', name: '', explain: 'Not a valid SPF term.', lookups: 0 });
      continue;
    }
    const qualifier = m[1] || '+';
    const name = m[2].toLowerCase();
    const arg = m[3] ?? null;
    const slash = m[4] ?? '';
    const t = { raw: term, kind: 'mechanism', qualifier, result: QUALIFIERS[qualifier], name, value: arg ?? '', target: null, cidr4: null, cidr6: null, lookups: 0 };
    try {
      switch (name) {
        case 'all':
          if (arg !== null || slash) throw new Error(`“${term}”: “all” takes no value.`);
          res.all = t;
          break;
        case 'include': case 'exists':
          if (!arg) throw new Error(`“${term}” needs a domain, like ${name}:_spf.example.com.`);
          if (!validDomainSpec(arg)) throw new Error(`“${term}” doesn’t name a valid domain.`);
          t.target = arg;
          break;
        case 'a': case 'mx': {
          const c = parseCidrs((arg ?? '') + slash, term);
          if (arg !== null && !c.target) throw new Error(`“${term}” has a colon but no domain.`);
          if (c.target && !validDomainSpec(c.target)) throw new Error(`“${term}” doesn’t name a valid domain.`);
          Object.assign(t, { target: c.target || null, cidr4: c.cidr4, cidr6: c.cidr6 });
          break;
        }
        case 'ptr':
          if (arg !== null && !validDomainSpec(arg)) throw new Error(`“${term}” doesn’t name a valid domain.`);
          t.target = arg;
          findings.push(finding('warn', '“ptr” is deprecated (RFC 7208 §5.5): it’s slow, and many receivers skip it. List the servers’ addresses or use “a” instead.'));
          break;
        case 'ip4': case 'ip6': {
          if (!arg) throw new Error(`“${term}” needs an address, like ${name === 'ip4' ? 'ip4:192.0.2.0/24' : 'ip6:2001:db8::/32'}.`);
          const [addr, len, extra] = arg.split('/');
          if (extra !== undefined) throw new Error(`“${term}” has more than one prefix length.`);
          if (name === 'ip4') parseIPv4(addr); else parseIPv6(addr);
          const max = name === 'ip4' ? 32 : 128;
          if (len !== undefined && !(/^\d+$/.test(len) && Number(len) <= max)) throw new Error(`“${term}”: the prefix length must be 0–${max}.`);
          if (len !== undefined && Number(len) < (name === 'ip4' ? 8 : 16)) findings.push(finding('warn', `“${term}” allows a huge range of addresses. Check the prefix length.`));
          t.value = arg;
          break;
        }
        default:
          throw new Error(`“${name}” isn’t an SPF mechanism, so the whole record is invalid (PermError).`);
      }
    } catch (err) {
      error(err.message.startsWith('“') ? err.message : `“${term}”: ${err.message}`);
      t.kind = 'invalid';
    }
    if (LOOKUP_MECHANISMS.has(name)) t.lookups = 1;
    if (t.kind !== 'invalid') {
      t.explain = `${name === 'all' ? '' : `${QUALIFIER_TEXT[qualifier]}: `}${explainMechanism(t, domain)}`;
      if ((t.target && hasMacro(t.target))) t.explain += ' Uses macros, which receivers expand per message.';
    } else {
      t.explain = 'Invalid.';
    }
    terms.push(t);
  }

  res.lookups = terms.reduce((n, t) => n + (t.kind === 'invalid' ? 0 : t.lookups), 0);
  if (afterAll.length) {
    findings.push(finding('warn', `Everything after “${res.all.raw}” is ignored: ${afterAll.join(' ')}.`));
    for (const raw2 of afterAll) terms.push({ raw: raw2, kind: 'ignored', name: '', explain: 'Ignored: comes after “all”.', lookups: 0 });
  }
  if (res.all && res.redirect) findings.push(finding('warn', '“redirect=” is ignored because the record has an “all” mechanism.'));
  if (res.all && res.redirect) {
    const r = terms.find((t) => t.name === 'redirect');
    r.lookups = 0;
    r.explain = 'Ignored, because the record has “all”.';
    res.lookups -= 1;
  }
  if (!res.all && !res.redirect && res.valid) {
    findings.push(finding('warn', 'No “all” at the end, so servers not listed get a neutral result, as if there were no SPF record. End with “~all” or “-all”.'));
  }
  if (res.all?.qualifier === '+') findings.push(finding('error', '“+all” allows every server on the internet to send as this domain.'));
  if (res.all?.qualifier === '?') findings.push(finding('warn', '“?all” gives unlisted servers a neutral result, which protects almost nothing. Use “~all” or “-all”.'));
  if (res.all?.qualifier === '~' && res.valid) findings.push(finding('info', '“~all” (softfail): unlisted servers are marked suspicious rather than rejected. With DMARC at p=quarantine or p=reject, that’s usually enough.'));
  if (res.all?.qualifier === '-' && res.valid) findings.push(finding('ok', '“-all”: mail from servers not listed fails SPF.'));
  if (res.lookups > SPF_LOOKUP_LIMIT) {
    findings.push(finding('error', `${res.lookups} DNS lookups in this record alone; the limit is ${SPF_LOOKUP_LIMIT}, so receivers return PermError.`));
  }
  if (record.length > 450) findings.push(finding('warn', `The record is ${record.length} characters. Over about 450, DNS answers may not fit in one UDP packet; consider moving senders into an include.`));
  return res;
}

// Follows include: and redirect= to count DNS lookups the way receivers do.
// getTxt(name) → { rcode, texts: [joined TXT strings] }; getMx(name) →
// { rcode, hosts: [names] } (optional).
export async function checkSpf(domain, { getTxt, getMx = null }) {
  const state = { lookups: 0, voids: 0, ips: [], seen: new Set(), queries: 0 };
  const findings = [];

  async function load(name, depth, via) {
    const node = { domain: name, via, depth, record: null, parsed: null, children: [], error: null, mxHosts: null };
    if (state.queries++ > 40) { node.error = 'Stopped following includes after 40 queries.'; return node; }
    let r;
    try {
      r = await getTxt(name);
    } catch (err) {
      node.error = err.message;
      return node;
    }
    const spf = r.texts.filter((t) => /^v=spf1(\s|$)/i.test(t));
    if (r.rcode === 3 || !spf.length) {
      if (depth > 0) state.voids++;
      node.error = r.rcode === 3 ? `${name} doesn’t exist (NXDOMAIN).` : `${name} has no SPF record.`;
      return node;
    }
    if (spf.length > 1) node.error = `${name} has ${spf.length} SPF records; there must be exactly one, so receivers return PermError.`;
    node.record = spf[0];
    node.parsed = parseSpf(spf[0], name);
    for (const t of node.parsed.terms) {
      if (t.kind === 'invalid' || t.kind === 'ignored') continue;
      if (t.name === 'ip4' || t.name === 'ip6') state.ips.push({ value: t.value, result: t.result, from: name });
      if (!t.lookups) continue;
      state.lookups++;
      const target = t.target;
      if ((t.name === 'include' || t.name === 'redirect') && target && !hasMacro(target)) {
        if (state.seen.has(target.toLowerCase())) {
          node.children.push({ domain: target, via: t.name, depth: depth + 1, error: `${target} is already included above (a loop or duplicate).`, children: [] });
        } else if (depth >= 9) {
          node.children.push({ domain: target, via: t.name, depth: depth + 1, error: 'Too deeply nested; stopped here.', children: [] });
        } else {
          state.seen.add(target.toLowerCase());
          node.children.push(await load(target, depth + 1, t.name));
        }
      } else if (t.name === 'mx' && getMx && !(target && hasMacro(target))) {
        try {
          const mx = await getMx(target || name);
          state.queries++;
          t.mxHosts = mx.hosts;
          if (!mx.hosts.length) state.voids++;
          if (mx.hosts.length > 10) findings.push(finding('error', `“${t.raw}” in ${name} has ${mx.hosts.length} MX hosts; SPF allows at most 10 (PermError).`));
        } catch { /* the page shows lookup errors elsewhere */ }
      }
    }
    return node;
  }

  state.seen.add(domain.toLowerCase());
  const root = await load(domain, 0, 'root');
  const walk = (n, fn) => { fn(n); for (const c of n.children ?? []) walk(c, fn); };
  walk(root, (n) => {
    if (n === root) return;
    if (n.error && n.via === 'include') findings.push(finding('error', `include:${n.domain}: ${n.error} An include that can’t be resolved makes the whole record fail (PermError).`));
    else if (n.error && n.via === 'redirect') findings.push(finding('error', `redirect=${n.domain}: ${n.error}`));
    for (const f of n.parsed?.findings ?? []) if (f.level === 'error') findings.push(finding('error', `In ${n.domain}: ${f.text}`));
  });
  if (root.error) findings.unshift(finding('error', root.error));
  if (root.record) {
    if (state.lookups > SPF_LOOKUP_LIMIT) {
      findings.unshift(finding('error', `${state.lookups} DNS lookups in total, counting includes; the limit is ${SPF_LOOKUP_LIMIT}. Receivers stop and return PermError, so SPF fails for all your mail. Remove unused includes, or replace some with ip4:/ip6: ranges.`));
    } else if (state.lookups >= 8) {
      findings.unshift(finding('warn', `${state.lookups} of ${SPF_LOOKUP_LIMIT} DNS lookups used, counting includes. Adding another sending service may push it over.`));
    }
    if (state.voids > SPF_VOID_LIMIT) findings.unshift(finding('error', `${state.voids} lookups returned nothing; receivers may fail SPF after ${SPF_VOID_LIMIT} (RFC 7208 §4.6.4).`));
  }
  return { root, lookups: state.lookups, voids: state.voids, ips: state.ips, findings };
}

// ---------- DMARC ----------

const DMARC_TAGS = {
  v: 'Version. Must be DMARC1 and come first.',
  p: 'Policy for mail that fails DMARC.',
  sp: 'Policy for subdomains (defaults to p).',
  np: 'Policy for subdomains that don’t exist (DMARCbis; defaults to sp).',
  adkim: 'DKIM alignment: r (relaxed, the same organisational domain) or s (strict, the exact domain).',
  aspf: 'SPF alignment: r (relaxed) or s (strict).',
  pct: 'Percentage of failing mail the policy applies to.',
  rua: 'Where receivers send daily aggregate reports.',
  ruf: 'Where receivers send per-message failure reports (few receivers do).',
  fo: 'When to send failure reports: 0 (all checks fail), 1 (any fails), d (DKIM fails), s (SPF fails).',
  rf: 'Failure report format (afrf).',
  ri: 'Requested seconds between aggregate reports (most send daily regardless).',
  t: 'Test mode (DMARCbis): y means apply the policy one step softer.',
  psd: 'Public suffix domain flag (DMARCbis).',
};
const POLICIES = ['none', 'quarantine', 'reject'];
const POLICY_TEXT = {
  none: 'delivered as normal (monitoring only)',
  quarantine: 'sent to spam or quarantine',
  reject: 'rejected',
};

export function parseDmarc(text) {
  const record = unquote(text);
  const findings = [];
  const tags = [];
  const res = { record, tags, findings, valid: true, policy: null, values: {} };
  const error = (msg) => { findings.push(finding('error', msg)); res.valid = false; };
  const parts = record.split(';').map((s) => s.trim()).filter(Boolean);
  if (!parts.length || !/^v\s*=\s*DMARC1$/.test(parts[0])) {
    error(/^v\s*=\s*dmarc1$/i.test(parts[0] ?? '') ? 'The version must be written exactly “v=DMARC1” (upper case).' : 'A DMARC record must start with “v=DMARC1;”.');
    if (!/^v\s*=\s*dmarc1$/i.test(parts[0] ?? '')) return res;
  }
  for (const part of parts) {
    const m = /^([A-Za-z]+)\s*=\s*(.*)$/.exec(part);
    if (!m) {
      error(`“${part}” isn’t a tag=value pair.`);
      continue;
    }
    const name = m[1].toLowerCase();
    const value = m[2].trim();
    const tag = { name, value, explain: DMARC_TAGS[name] ?? 'Unknown tag; receivers ignore it.', valid: true };
    tags.push(tag);
    if (res.values[name] !== undefined) {
      error(`“${name}=” appears more than once.`);
      continue;
    }
    res.values[name] = value;
    const bad = (msg) => { tag.valid = false; error(msg); };
    switch (name) {
      case 'p': case 'sp': case 'np':
        if (!POLICIES.includes(value.toLowerCase())) bad(`${name}=${value}: the policy must be none, quarantine or reject.`);
        break;
      case 'adkim': case 'aspf':
        if (!/^[rs]$/i.test(value)) bad(`${name}=${value}: must be r (relaxed) or s (strict).`);
        break;
      case 'pct':
        if (!/^\d{1,3}$/.test(value) || Number(value) > 100) bad(`pct=${value}: must be a whole number from 0 to 100.`);
        break;
      case 'ri':
        if (!/^\d+$/.test(value)) bad(`ri=${value}: must be a number of seconds.`);
        break;
      case 'fo':
        if (!/^[01ds](:[01ds])*$/i.test(value)) bad(`fo=${value}: options are 0, 1, d and s, separated by colons.`);
        break;
      case 'rf':
        if (value.toLowerCase() !== 'afrf') findings.push(finding('warn', `rf=${value}: the only defined format is afrf.`));
        break;
      case 't':
        if (!/^[yn]$/i.test(value)) bad(`t=${value}: must be y or n.`);
        break;
      case 'psd':
        if (!/^[ynu]$/i.test(value)) bad(`psd=${value}: must be y, n or u.`);
        break;
      case 'rua': case 'ruf': {
        const uris = value.split(',').map((s) => s.trim());
        tag.uris = [];
        for (const u of uris) {
          const um = /^mailto:([^!@\s]+@([^!\s]+?))(!\d+[kmgt]?)?$/i.exec(u);
          if (!um) bad(`${name}: “${u}” must be a mailto: address, like mailto:dmarc@example.com.`);
          else tag.uris.push({ address: um[1], domain: um[2].toLowerCase() });
        }
        break;
      }
      case 'v':
        break;
      default:
        findings.push(finding('warn', `Unknown tag “${name}=” is ignored. Check it isn’t a typo.`));
    }
  }
  if (tags.length && tags[0].name !== 'v') error('“v=DMARC1” must be the first tag.');
  const p = res.values.p?.toLowerCase();
  if (!p) {
    if (res.values.rua) findings.push(finding('warn', 'No p= tag. Receivers treat the record as p=none because rua= is set, but add p= explicitly.'));
    else error('The p= (policy) tag is required.');
  }
  const policy = POLICIES.includes(p) ? p : res.values.rua ? 'none' : null;
  res.policy = policy;
  if (policy) {
    const pct = res.values.pct !== undefined && /^\d+$/.test(res.values.pct) ? Number(res.values.pct) : 100;
    res.pct = pct;
    const sp = POLICIES.includes(res.values.sp?.toLowerCase()) ? res.values.sp.toLowerCase() : policy;
    res.summary = `Mail that fails DMARC is ${POLICY_TEXT[policy]}${policy !== 'none' && pct < 100 ? ` (${pct}% of it; the rest is treated one step softer)` : ''}.${sp !== policy ? ` For subdomains: ${POLICY_TEXT[sp]}.` : ''}`;
    if (policy === 'none') findings.push(finding('warn', 'p=none only monitors: spoofed mail is still delivered. Once the reports show your real senders pass, move to p=quarantine, then p=reject.'));
    if (policy === 'quarantine') findings.push(finding('info', 'p=quarantine sends failing mail to spam. p=reject is the strongest protection once you’re confident.'));
    if (policy === 'reject') findings.push(finding('ok', 'p=reject: receivers reject mail that fails DMARC.'));
    if (policy !== 'none' && pct < 100) findings.push(finding('warn', `pct=${pct}: the policy applies to only ${pct}% of failing mail.`));
    if (res.values.sp?.toLowerCase() === 'none' && policy !== 'none') findings.push(finding('warn', 'sp=none leaves subdomains unprotected: spoofed mail from any subdomain is delivered.'));
  }
  if (!res.values.rua) findings.push(finding('warn', 'No rua= address, so you get no reports showing who sends mail as your domain.'));
  if (res.values.ruf) findings.push(finding('info', 'ruf= (failure reports): few receivers send these, and they can contain message content.'));
  if (/^y$/i.test(res.values.t ?? '')) findings.push(finding('warn', 't=y (test mode): receivers apply a softer policy than p= says.'));
  return res;
}

// "mail.example.co" → candidate parent names for the DMARC fallback. Without
// the Public Suffix List this stops at two labels, which is wrong for
// suffixes like co.uk; the page says so.
export function dmarcParents(domain) {
  const labels = domain.replace(/\.$/, '').split('.');
  const out = [];
  for (let i = 1; labels.length - i >= 2; i++) out.push(labels.slice(i).join('.'));
  return out;
}

// External report addresses need the receiving domain's permission:
// <domain>._report._dmarc.<their domain> TXT "v=DMARC1" (RFC 7489 §7.1).
export function externalReportChecks(domain, parsed) {
  const d = domain.toLowerCase().replace(/\.$/, '');
  const out = [];
  for (const tag of parsed.tags.filter((t) => t.uris)) {
    for (const u of tag.uris) {
      const r = u.domain;
      const related = r === d || r.endsWith('.' + d) || d.endsWith('.' + r);
      if (!related && !out.some((o) => o.domain === r)) out.push({ domain: r, name: `${d}._report._dmarc.${r}` });
    }
  }
  return out;
}

// ---------- DKIM ----------

const DKIM_TAGS = {
  v: 'Version (DKIM1).',
  k: 'Key type: rsa (default) or ed25519.',
  p: 'The public key (base64). Empty means the key has been revoked.',
  h: 'Hash algorithms allowed (sha256; sha1 is obsolete).',
  t: 'Flags: y means testing (receivers treat failures leniently), s means strict subdomain matching.',
  s: 'Service types (* or email).',
  n: 'Notes for humans.',
  g: 'Granularity (obsolete, from RFC 4871).',
};

function base64Bytes(s) {
  const clean = s.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1) return null;
  const bin = atob(clean.padEnd(Math.ceil(clean.length / 4) * 4, '='));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// RSA modulus size in bits from SubjectPublicKeyInfo or PKCS#1 DER.
export function rsaKeyBits(der) {
  let p = 0;
  const read = () => {
    const tag = der[p++];
    let len = der[p++];
    if (len & 0x80) {
      const n = len & 0x7f;
      if (n > 4) throw new Error('bad length');
      len = 0;
      for (let i = 0; i < n; i++) len = (len << 8) | der[p++];
    }
    if (p + len > der.length) throw new Error('truncated');
    return { tag, start: p, len };
  };
  try {
    const outer = read();
    if (outer.tag !== 0x30) return null;
    const first = read();
    if (first.tag === 0x30) {
      // SPKI: algorithm identifier, then BIT STRING (unused-bits byte, RSAPublicKey).
      p = first.start + first.len;
      const bits = read();
      if (bits.tag !== 0x03) return null;
      p = bits.start + 1;
      const seq = read();
      if (seq.tag !== 0x30) return null;
      const n = read();
      return modBits(der, n);
    }
    if (first.tag === 0x02) return modBits(der, first);
    return null;
  } catch {
    return null;
  }
}

function modBits(der, n) {
  if (n.tag !== 0x02) return null;
  let s = n.start;
  let len = n.len;
  while (len > 0 && der[s] === 0) { s++; len--; }
  if (!len) return 0;
  return (len - 1) * 8 + (32 - Math.clz32(der[s]));
}

export function parseDkim(text) {
  const record = unquote(text);
  const findings = [];
  const tags = [];
  const res = { record, tags, findings, valid: true, keyType: 'rsa', keyBits: null, revoked: false, values: {} };
  const error = (msg) => { findings.push(finding('error', msg)); res.valid = false; };
  for (const part of record.split(';').map((s) => s.trim()).filter(Boolean)) {
    const m = /^([A-Za-z]+)\s*=\s*([\s\S]*)$/.exec(part);
    if (!m) { error(`“${part.slice(0, 40)}” isn’t a tag=value pair.`); continue; }
    const name = m[1].toLowerCase();
    const value = m[2].trim();
    if (res.values[name] !== undefined) { error(`“${name}=” appears more than once.`); continue; }
    res.values[name] = value;
    tags.push({ name, value, explain: DKIM_TAGS[name] ?? 'Unknown tag; ignored.' });
  }
  if (res.values.v !== undefined && res.values.v !== 'DKIM1') error(`v=${res.values.v}: must be DKIM1.`);
  if (res.values.v !== undefined && tags[0]?.name !== 'v') error('v=DKIM1 must be the first tag.');
  res.keyType = (res.values.k ?? 'rsa').toLowerCase();
  if (!['rsa', 'ed25519'].includes(res.keyType)) error(`k=${res.values.k}: unknown key type; use rsa or ed25519.`);
  if (res.values.p === undefined) {
    error('The p= (public key) tag is required.');
  } else if (res.values.p === '') {
    res.revoked = true;
    findings.push(finding('warn', 'p= is empty: this key has been revoked, so signatures with this selector fail.'));
  } else {
    const der = base64Bytes(res.values.p);
    if (!der) error('p= isn’t valid base64. Check for stray quotes or characters from line wrapping.');
    else if (res.keyType === 'ed25519') {
      res.keyBits = der.length * 8;
      if (der.length !== 32) error(`An Ed25519 key is 32 bytes; this one is ${der.length}.`);
      else findings.push(finding('info', 'Ed25519 key. Not every receiver verifies Ed25519 yet, so sign with an RSA key as well.'));
    } else {
      res.keyBits = rsaKeyBits(der);
      if (res.keyBits === null) error('p= doesn’t decode to an RSA public key.');
      else if (res.keyBits < 1024) error(`${res.keyBits}-bit RSA key: too weak, and receivers ignore keys under 1024 bits.`);
      else if (res.keyBits < 2048) findings.push(finding('warn', `${res.keyBits}-bit RSA key: still accepted, but 2048 bits is the recommended minimum.`));
      else findings.push(finding('ok', `${res.keyBits}-bit RSA key.`));
    }
  }
  if (/^sha1$/i.test(res.values.h ?? '')) findings.push(finding('warn', 'h=sha1 only: SHA-1 signatures are obsolete and many receivers reject them.'));
  if ((res.values.t ?? '').split(':').some((f) => f.trim().toLowerCase() === 'y')) findings.push(finding('warn', 't=y: testing mode. Receivers may ignore failures; remove it once signing works.'));
  return res;
}

// Selectors used by common providers; DKIM selectors can't be listed, so the
// page tries these.
export const COMMON_SELECTORS = [
  'google', 'selector1', 'selector2', 'k1', 'k2', 'k3', 's1', 's2', 'default', 'dkim', 'mail',
  'fm1', 'fm2', 'fm3', 'protonmail', 'protonmail2', 'protonmail3', 'mxvault', 'smtp', 'mandrill',
];

// Worst level in a list of findings: 'error' > 'warn' > 'ok'.
export function verdict(findings) {
  if (findings.some((f) => f.level === 'error')) return 'error';
  if (findings.some((f) => f.level === 'warn')) return 'warn';
  return 'ok';
}
