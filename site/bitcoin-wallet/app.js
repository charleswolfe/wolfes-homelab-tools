import { ADDRESS_TYPES, NETWORKS, generatePrivateKey, toWif, fromWif, deriveAddresses, descriptorFor } from '/lib/bitcoin.js';
import { encodeQr } from '/lib/qr.js';
import { layout, toSvg } from '/lib/qr-render.js';
import { $, $$, storage, alertHTML, escapeHTML, toast, debounce } from '/assets/ui.js';
import { icon } from '/assets/icons.js';

const HINTS = {
  p2wpkh: 'Recommended. Low fees, and almost every wallet and exchange can send to it.',
  p2tr: 'Newest type with the lowest fees. Some older services can’t send to it yet, and spending needs Bitcoin Core or Sparrow.',
  'p2sh-p2wpkh': 'Older SegWit format for senders that can’t pay to bc1 addresses.',
  p2pkh: 'The original format. Works everywhere, but has the highest fees.',
};

const el = {
  checks: $('#checks'),
  types: $('#types'),
  typeHint: $('#type-hint'),
  networks: $$('input[name=network]'),
  count: $('#count'),
  entropy: $('#entropy'),
  panel: $('#wallets-panel'),
  wallets: $('#wallets'),
  reveal: $('#reveal'),
  checkWif: $('#check-wif'),
  checkRows: $('#check-rows'),
  checkMessages: $('#check-messages'),
  checkToggle: $('#check-toggle'),
};

// Only the chosen type and network are remembered; keys never touch storage.
const saved = storage.get('bitcoin-wallet', {});
let typeId = ADDRESS_TYPES.some((t) => t.id === saved.type) ? saved.type : 'p2wpkh';
el.networks.forEach((r) => { r.checked = r.value === (saved.network === 'testnet' ? 'testnet' : 'mainnet'); });
const network = () => el.networks.find((r) => r.checked).value;
const persist = () => storage.set('bitcoin-wallet', { type: typeId, network: network() });

let generated = []; // public addresses of the cards on screen, for the checker

// ---------- safety checks ----------

function renderChecks() {
  const row = (label, value, ok, okText = 'OK', badText = 'Check') => `<div class="kv check-row">
    <span class="kv-label">${label}</span>
    <span class="kv-value is-plain">${value}</span>
    <span class="badge ${ok ? 'badge-ok' : 'badge-warn'}">${ok ? icon('check') + ' ' + okText : icon('alert') + ' ' + badText}</span>
  </div>`;
  const online = navigator.onLine;
  const randomOk = typeof globalThis.crypto?.getRandomValues === 'function';
  el.checks.innerHTML = [
    row('Network', online ? 'This device is online. For real funds, disconnect before generating keys.' : 'This device is offline.', !online, 'Offline', 'Online'),
    row('Page connection', window.isSecureContext ? 'Loaded over HTTPS (or localhost), so it can’t have been altered in transit.' : 'Loaded over plain HTTP. Someone on the network could have altered this page.', window.isSecureContext, 'Secure', 'HTTP'),
    row('Outgoing requests', 'Blocked. This page’s security policy (connect-src ’none’) forbids every network connection.', true, 'Blocked'),
    row('Randomness', randomOk ? 'Keys come from the browser’s cryptographic generator (crypto.getRandomValues).' : 'This browser has no cryptographic random generator. Don’t use it for keys.', randomOk, 'Secure', 'Missing'),
    row('Storage', 'Keys are only kept on this page and never written to browser storage.', true, 'None'),
  ].join('');
}
window.addEventListener('online', renderChecks);
window.addEventListener('offline', renderChecks);

// ---------- generate ----------

function renderTypes() {
  el.types.innerHTML = ADDRESS_TYPES.map((t) => `<label><input type="radio" name="type" value="${t.id}"${t.id === typeId ? ' checked' : ''}><span>${t.name}</span></label>`).join('');
  el.typeHint.textContent = `${ADDRESS_TYPES.find((t) => t.id === typeId).prefix[network()]}… · ${HINTS[typeId]}`;
}

// Bech32 addresses go into the QR in uppercase: same address, but it fits the
// compact alphanumeric mode (BIP 173 recommends this).
const qrText = (s) => (/^(bc|tb)1/i.test(s) ? s.toUpperCase() : s);

function qrImage(text, alt) {
  const svg = toSvg(layout(encodeQr(qrText(text), { ecc: 'M' }), { margin: 2 }), { fg: '#000000', bg: '#ffffff', sizePx: 400 });
  return `<img class="wallet-qr" alt="${escapeHTML(alt)}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}">`;
}

function cardHTML(w, i, total) {
  const t = ADDRESS_TYPES.find((x) => x.id === w.type);
  return `<article class="wallet-card" data-index="${i}">
    <header class="wallet-head">
      <span>Bitcoin paper wallet${total > 1 ? ` ${i + 1} of ${total}` : ''}</span>
      <span class="badge${w.network === 'testnet' ? ' badge-warn' : ''}">${t.name} · ${NETWORKS[w.network].name}</span>
    </header>
    <div class="wallet-body">
      <section class="wallet-side wallet-public">
        <h3>Address<small>Share this to receive bitcoin</small></h3>
        ${qrImage(w.address, 'QR code of the address')}
        <code class="wallet-text">${w.address}</code>
        <button class="btn btn-ghost" type="button" data-copy="${w.address}">${icon('copy')}Copy address</button>
      </section>
      <div class="wallet-fold" aria-hidden="true"></div>
      <section class="wallet-side wallet-private">
        <h3>Private key<small>Secret: anyone who sees it can spend the funds</small></h3>
        <div class="secret">
          <div class="secret-blur">
            ${qrImage(w.wif, 'QR code of the private key')}
            <code class="wallet-text">${w.wif}</code>
            <span class="wallet-descriptor">${w.descriptor}</span>
          </div>
          <div class="secret-cover"><button class="btn" type="button" data-reveal>${icon('alert')}Reveal private key</button></div>
        </div>
      </section>
    </div>
  </article>`;
}

function generate() {
  const n = Math.min(8, Math.max(1, Math.floor(Number(el.count.value)) || 1));
  el.count.value = n;
  const net = network();
  const wallets = [];
  for (let i = 0; i < n; i++) {
    const priv = generatePrivateKey(el.entropy.value);
    const wif = toWif(priv, net);
    wallets.push({ type: typeId, network: net, address: deriveAddresses(priv, net)[typeId], wif, descriptor: descriptorFor(typeId, wif) });
    priv.fill(0); // best effort; JS can't guarantee memory is wiped
  }
  el.entropy.value = '';
  generated = wallets.map((w) => w.address);
  el.wallets.innerHTML = wallets.map((w, i) => cardHTML(w, i, n)).join('');
  el.reveal.checked = false;
  el.panel.hidden = false;
  el.panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  renderCheck();
}

function clearWallets() {
  el.wallets.innerHTML = '';
  generated = [];
  el.panel.hidden = true;
  el.reveal.checked = false;
  renderCheck();
  toast('Wallets cleared from the page');
}

// ---------- checker ----------

function renderCheck() {
  el.checkMessages.innerHTML = '';
  el.checkRows.innerHTML = '';
  const wif = el.checkWif.value;
  if (!wif.trim()) return;
  let key;
  try {
    key = fromWif(wif);
  } catch (err) {
    el.checkMessages.innerHTML = alertHTML('error', err.message);
    return;
  }
  const addrs = deriveAddresses(key.priv, key.network, key.compressed);
  key.priv.fill(0);
  const notes = [`${NETWORKS[key.network].name} key, ${key.compressed ? 'compressed' : 'uncompressed'} public key.`];
  if (!key.compressed) notes.push('Uncompressed keys only have a Legacy address.');
  el.checkMessages.innerHTML = alertHTML('ok', notes.join(' '));
  el.checkRows.innerHTML = ADDRESS_TYPES.filter((t) => addrs[t.id]).map((t) => {
    const a = addrs[t.id];
    const match = generated.includes(a);
    return `<div class="kv${match ? ' is-match' : ''}">
      <span class="kv-label">${t.name}${match ? ' <span class="badge badge-ok">matches card</span>' : ''}</span>
      <span class="kv-value">${a}</span>
      <button class="btn btn-ghost btn-icon" type="button" data-copy="${a}" aria-label="Copy ${t.name} address" title="Copy">${icon('copy')}</button>
    </div>`;
  }).join('');
}

// ---------- wiring ----------

el.types.addEventListener('change', (e) => { typeId = e.target.value; persist(); renderTypes(); });
el.networks.forEach((r) => r.addEventListener('change', () => { persist(); renderTypes(); }));
$('#generate').addEventListener('click', generate);
$('#print').addEventListener('click', () => window.print());
$('#clear').addEventListener('click', clearWallets);
el.reveal.addEventListener('change', () => {
  $$('.wallet-card', el.wallets).forEach((c) => c.classList.toggle('is-revealed', el.reveal.checked));
});
el.wallets.addEventListener('click', (e) => {
  if (e.target.closest('[data-reveal]')) e.target.closest('.wallet-card').classList.add('is-revealed');
});
el.checkWif.addEventListener('input', debounce(renderCheck, 120));
el.checkToggle.addEventListener('click', () => {
  const show = el.checkWif.type === 'password';
  el.checkWif.type = show ? 'text' : 'password';
  el.checkToggle.textContent = show ? 'Hide' : 'Show';
  el.checkToggle.setAttribute('aria-pressed', String(show));
});

renderChecks();
renderTypes();
