import { decodeJwt, tokenStatus, CLAIMS, TIME_CLAIMS, HEADER_PARAMS, ALG_NAMES } from '/lib/jwt.js';
import { relative } from '/lib/timestamp.js';
import { bytesToBase64 } from '/lib/base64.js';
import { toHex } from '/lib/hash.js';
import { $, debounce, copyText, kvRow, alertHTML, escapeHTML, highlightJSON, formatBytes } from '/assets/ui.js';
import { icon } from '/assets/icons.js';

const el = {
  token: $('#token'),
  colored: $('#colored'),
  messages: $('#messages'),
  decoded: $('#decoded'),
  headerJson: $('#header-json'),
  headerRows: $('#header-rows'),
  payloadJson: $('#payload-json'),
  claimsPanel: $('#claims-panel'),
  claims: $('#claims'),
  sigPanel: $('#sig-panel'),
  sig: $('#sig'),
};

let last = null;

const pretty = (v) => JSON.stringify(v, null, 2);
const fmtTime = (sec) => {
  const d = new Date(sec * 1000);
  return Number.isNaN(d.getTime()) ? String(sec) : `${d.toLocaleString()} (${relative(sec * 1000)})`;
};

function statusBanner(payload) {
  const s = tokenStatus(payload);
  const when = s.at ? new Date(s.at * 1000).toLocaleString() : '';
  switch (s.state) {
    case 'expired': return `<div class="status-banner alert-error">${icon('alert')}<div>Expired ${relative(s.at * 1000)}<small>exp: ${escapeHTML(when)}</small></div></div>`;
    case 'pending': return `<div class="status-banner alert-warn">${icon('clock')}<div>Not valid yet: becomes valid ${relative(s.at * 1000)}<small>nbf: ${escapeHTML(when)}</small></div></div>`;
    case 'valid': return `<div class="status-banner alert-ok">${icon('check')}<div>Not expired: expires ${relative(s.at * 1000)}<small>exp: ${escapeHTML(when)}</small></div></div>`;
    default: return '';
  }
}

function render() {
  const raw = el.token.value;
  el.messages.innerHTML = '';
  last = null;
  let r;
  try {
    r = decodeJwt(raw);
  } catch (err) {
    hideResults();
    el.messages.innerHTML = alertHTML('error', err.message);
    return;
  }
  if (!r) { hideResults(); return; }
  last = r;

  // Colour-coded echo of the token's parts.
  const cls = r.kind === 'JWE' ? ['jwt-h', 'jwt-p', 'jwt-p', 'jwt-p', 'jwt-s'] : ['jwt-h', 'jwt-p', 'jwt-s'];
  el.colored.innerHTML = r.parts.map((p, i) => `<span class="${cls[i]}">${escapeHTML(p)}</span>`).join('<span class="jwt-dot">.</span>');
  el.colored.hidden = false;

  el.messages.innerHTML = (r.payload ? statusBanner(r.payload) : '') + r.warnings.map((w) => alertHTML('warn', w)).join('');

  el.decoded.hidden = false;
  el.headerJson.innerHTML = highlightJSON(pretty(r.header));
  el.headerRows.innerHTML = Object.entries(r.header)
    .filter(([k]) => HEADER_PARAMS[k])
    .map(([k, v]) => kvRow(HEADER_PARAMS[k], k === 'alg' && ALG_NAMES[v] ? `${v} · ${ALG_NAMES[v]}` : typeof v === 'string' ? v : JSON.stringify(v), { sub: k, plain: k === 'alg' }))
    .join('');

  if (r.kind === 'JWE') {
    el.payloadJson.innerHTML = '<span class="null">Encrypted. The payload cannot be read without the key.</span>';
    el.claimsPanel.hidden = true;
    el.sigPanel.hidden = true;
    return;
  }

  el.payloadJson.innerHTML = r.payload !== undefined ? highlightJSON(pretty(r.payload)) : escapeHTML(r.payloadText);

  const isObj = r.payload && typeof r.payload === 'object' && !Array.isArray(r.payload);
  el.claimsPanel.hidden = !isObj;
  if (isObj) {
    el.claims.innerHTML = Object.entries(r.payload).map(([k, v]) => {
      const label = CLAIMS[k] || k;
      const sub = CLAIMS[k] ? k : '';
      if (TIME_CLAIMS.has(k) && typeof v === 'number') return kvRow(label, fmtTime(v), { sub, plain: true });
      return kvRow(label, typeof v === 'string' ? v : JSON.stringify(v), { sub });
    }).join('');
  }

  el.sigPanel.hidden = false;
  el.sig.innerHTML = [
    kvRow('Algorithm', r.header.alg ? `${r.header.alg}${ALG_NAMES[r.header.alg] ? ' · ' + ALG_NAMES[r.header.alg] : ''}` : 'none', { plain: true, copy: false }),
    kvRow('Length', r.signature.length ? `${formatBytes(r.signature.length)} (${r.signature.length * 8} bits)` : 'Empty: token is unsigned', { plain: true, copy: false }),
    kvRow('Base64URL', r.parts[2]),
    kvRow('Hex', toHex(r.signature)),
    `<div class="kv"><span class="kv-label">Verification</span><span class="kv-value is-plain is-muted">Checking the signature needs the issuer’s secret or public key and is not done here.</span><span></span></div>`,
  ].join('');
}

function hideResults() {
  el.colored.hidden = true;
  el.decoded.hidden = true;
  el.claimsPanel.hidden = true;
  el.sigPanel.hidden = true;
}

// A demo token, unsigned in practice (fake signature), valid for one hour.
function exampleToken() {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => bytesToBase64(new TextEncoder().encode(JSON.stringify(o)), { urlSafe: true, pad: false });
  const header = { alg: 'HS256', typ: 'JWT', kid: 'homelab-2026' };
  const payload = { iss: 'https://auth.homelab.lan', sub: 'user-42', aud: 'tools', name: 'Ada Lovelace', roles: ['admin'], iat: now, nbf: now, exp: now + 3600 };
  const sig = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)), { urlSafe: true, pad: false });
  return `${enc(header)}.${enc(payload)}.${sig}`;
}

el.token.addEventListener('input', debounce(render, 60));
$('#clear').addEventListener('click', () => { el.token.value = ''; render(); el.token.focus(); });
$('#example').addEventListener('click', () => { el.token.value = exampleToken(); render(); });
$('#copy-header').addEventListener('click', (e) => last && copyText(pretty(last.header), e.currentTarget));
$('#copy-payload').addEventListener('click', (e) => last && copyText(last.payload !== undefined ? pretty(last.payload) : last.payloadText || '', e.currentTarget));

render();
