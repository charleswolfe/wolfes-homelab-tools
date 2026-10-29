// VIA launcher: requirement checks and already-authorized keyboards.
import { $, escapeHTML } from '/assets/ui.js';
import { icon } from '/assets/icons.js';

const hid = 'hid' in navigator;
const secure = window.isSecureContext;
const ready = hid && secure;

const badge = (ok, okText, badText) => `<span class="badge ${ok ? 'badge-ok' : 'badge-danger'}">${icon(ok ? 'check' : 'alert')} ${ok ? okText : badText}</span>`;
const row = (label, text, ok, okText, badText) => `<div class="kv check-row"><span class="kv-label">${label}</span><span class="kv-value is-plain">${text}</span>${badge(ok, okText, badText)}</div>`;

$('#checks').innerHTML = [
  row('Browser', hid
    ? 'This browser supports WebHID, which VIA uses to talk to keyboards.'
    : 'This browser can’t talk to keyboards (no WebHID). Use Chrome, Edge, Brave, Opera or another Chromium-based browser on a computer.', hid, 'Supported', 'Not supported'),
  row('Connection', secure
    ? 'Secure page (HTTPS or localhost), so the browser allows keyboard access.'
    : 'Plain HTTP: browsers only allow keyboard access on HTTPS pages. See the notice at the top.', secure, 'Secure', 'Not secure'),
].join('');

$('#open-hint').textContent = ready
  ? 'Opens in this tab. Use the browser’s back button to return.'
  : 'VIA will open, but it won’t be able to find your keyboard until the issues above are fixed.';
if (!ready) $('#open').classList.replace('btn-primary', 'btn-outline');

// Keyboards granted earlier are visible without a prompt.
if (hid && secure) {
  const render = async () => {
    let devices = [];
    try {
      devices = await navigator.hid.getDevices();
    } catch { /* blocked by policy */ }
    // One keyboard exposes several HID interfaces; list it once.
    const unique = [...new Map(devices.map((d) => [`${d.vendorId}:${d.productId}`, d])).values()];
    $('#devices-panel').hidden = unique.length === 0;
    $('#devices').innerHTML = unique.map((d) => {
      const id = `${d.vendorId.toString(16).padStart(4, '0')}:${d.productId.toString(16).padStart(4, '0')}`;
      return `<div class="kv"><span class="kv-label">${escapeHTML(d.productName || 'Unnamed device')}</span><span class="kv-value">${id}</span><span></span></div>`;
    }).join('');
  };
  render();
  navigator.hid.addEventListener('connect', render);
  navigator.hid.addEventListener('disconnect', render);
}

// Written by scripts/via/build.sh.
import('/via/app/build-info.js').then(({ VIA_BUILD: b }) => {
  $('#version').textContent = `the-via/app ${b.app.slice(0, 7)}, the-via/keyboards ${b.keyboards.slice(0, 7)}, built ${b.built}`;
  $('.lede').textContent = $('.lede').textContent.replace('every keyboard in VIA’s catalog bundled', `all ${b.definitions.toLocaleString()} keyboard definitions in VIA’s catalog bundled`);
}).catch(() => { /* informational only */ });
