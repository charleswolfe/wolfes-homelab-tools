import { encodeQr, ECC_LEVELS } from '/lib/qr.js';
import { BUILDERS } from '/lib/qr-content.js';
import { layout, toSvg, paintCanvas, canvasSizeFor, contrastRatio, isInverted, parseHex } from '/lib/qr-render.js';
import { $, $$, storage, debounce, downloadBlob, alertHTML, escapeHTML, toast, formatBytes } from '/assets/ui.js';
import { icon } from '/assets/icons.js';

// ---------- content types ----------

const ADDRESS = [
  { k: 'street', label: 'Street', span: true },
  { k: 'city', label: 'City' },
  { k: 'region', label: 'State / region' },
  { k: 'postcode', label: 'Postcode' },
  { k: 'country', label: 'Country' },
];

const TYPES = [
  { id: 'url', label: 'URL', icon: 'link', hint: 'Opens a website. https:// is added if you leave it out.',
    fields: [{ k: 'url', label: 'URL', type: 'url', ph: 'https://example.com', span: true }], build: BUILDERS.url },
  { id: 'text', label: 'Text', icon: 'text', hint: 'Shows plain text on the phone.',
    fields: [{ k: 'text', label: 'Text', type: 'textarea', span: true, ph: 'Any text…' }], build: BUILDERS.text },
  { id: 'wifi', label: 'Wi-Fi', icon: 'wifi', hint: 'Phones offer to join the network when they scan this.',
    fields: [
      { k: 'ssid', label: 'Network name (SSID)', ph: 'HomeLab' },
      { k: 'auth', label: 'Security', type: 'select', options: [['WPA', 'WPA / WPA2 / WPA3'], ['WEP', 'WEP'], ['nopass', 'None (open)']], value: 'WPA' },
      { k: 'password', label: 'Password', ph: 'Network password', span: true },
      { k: 'hidden', label: 'Hidden network', type: 'switch', span: true },
    ], build: BUILDERS.wifi },
  { id: 'contact', label: 'Contact', icon: 'id', hint: 'Adds a contact card. MeCard makes a smaller code but holds fewer fields.',
    fields: [
      { k: 'format', label: 'Format', type: 'segmented', options: [['vcard', 'vCard'], ['mecard', 'MeCard']], value: 'vcard', span: true },
      { k: 'first', label: 'First name' }, { k: 'last', label: 'Last name' },
      { k: 'phone', label: 'Mobile', type: 'tel' }, { k: 'email', label: 'Email', type: 'email' },
      { k: 'org', label: 'Organization' }, { k: 'jobTitle', label: 'Job title' },
      { k: 'website', label: 'Website', type: 'url', span: true },
      ...ADDRESS,
      { k: 'note', label: 'Note', type: 'textarea', span: true },
    ], build: (v) => (v.format === 'mecard' ? BUILDERS.mecard(v) : BUILDERS.vcard(v)) },
  { id: 'email', label: 'Email', icon: 'mail', hint: 'Opens a new email with these details filled in.',
    fields: [
      { k: 'to', label: 'To', type: 'email', ph: 'someone@example.com', span: true },
      { k: 'subject', label: 'Subject', span: true },
      { k: 'body', label: 'Message', type: 'textarea', span: true },
    ], build: BUILDERS.email },
  { id: 'sms', label: 'SMS', icon: 'message', hint: 'Opens a text message to this number.',
    fields: [{ k: 'phone', label: 'Phone number', type: 'tel', ph: '+1 555 0100', span: true }, { k: 'message', label: 'Message', type: 'textarea', span: true }],
    build: BUILDERS.sms },
  { id: 'phone', label: 'Phone', icon: 'phone', hint: 'Starts a call. Include the country code for international use.',
    fields: [{ k: 'phone', label: 'Phone number', type: 'tel', ph: '+1 555 0100', span: true }], build: BUILDERS.phone },
  { id: 'geo', label: 'Location', icon: 'pin', hint: 'Opens the location in the phone’s maps app.',
    fields: [
      { k: 'lat', label: 'Latitude', type: 'number', ph: '51.5007', step: 'any' },
      { k: 'lng', label: 'Longitude', type: 'number', ph: '-0.1246', step: 'any' },
      { k: 'label', label: 'Label (optional)', span: true },
    ], build: BUILDERS.geo },
  { id: 'event', label: 'Event', icon: 'calendar', hint: 'Adds an event to the calendar. Times are converted to UTC.',
    fields: [
      { k: 'title', label: 'Title', span: true },
      { k: 'start', label: 'Starts', type: 'datetime-local' },
      { k: 'end', label: 'Ends', type: 'datetime-local' },
      { k: 'allDay', label: 'All-day event (times ignored)', type: 'switch', span: true },
      { k: 'location', label: 'Location', span: true },
      { k: 'description', label: 'Description', type: 'textarea', span: true },
    ], build: BUILDERS.event },
  { id: 'crypto', label: 'Crypto', icon: 'wallet', hint: 'A payment request that wallet apps understand.',
    fields: [
      { k: 'coin', label: 'Currency', type: 'select', options: [['bitcoin', 'Bitcoin'], ['litecoin', 'Litecoin'], ['ethereum', 'Ethereum']], value: 'bitcoin' },
      { k: 'amount', label: 'Amount (optional)', type: 'text', ph: '0.001' },
      { k: 'address', label: 'Address', ph: 'bc1q…', span: true, mono: true },
      { k: 'label', label: 'Label (optional)' },
      { k: 'message', label: 'Message (optional)' },
    ], build: BUILDERS.crypto },
];

// ---------- state ----------

const DEFAULT_STYLE = { fg: '#111111', bg: '#ffffff', transparent: false, module: 'square', ecc: 'M', margin: 4, exportSize: 1024, logoSize: 22, logoPlate: true };
const saved = storage.get('qr', {});
const style = { ...DEFAULT_STYLE, ...(saved.style || {}) };
let typeId = TYPES.some((t) => t.id === saved.type) ? saved.type : 'url';
const values = {};   // per type; deliberately never persisted (may hold Wi-Fi passwords)
let logo = null;     // { dataUrl, image, name }
let current = null;  // { qr, lay, text }
let genId = 0;

const el = {
  types: $('#types'), typeHint: $('#type-hint'), form: $('#form'), contentMessages: $('#content-messages'),
  preview: $('#preview'), empty: $('#empty'), meta: $('#meta'), capacity: $('#capacity'), capacityBar: $('#capacity-bar'),
  previewMessages: $('#preview-messages'), payload: $('#payload'),
  dlPng: $('#dl-png'), dlSvg: $('#dl-svg'), copyImg: $('#copy-img'),
  fg: $('#fg'), fgHex: $('#fg-hex'), bg: $('#bg'), bgHex: $('#bg-hex'), transparent: $('#transparent'),
  modules: $$('input[name=module]'), eccs: $$('input[name=ecc]'), eccGroup: $('#ecc-group'), eccHint: $('#ecc-hint'),
  margin: $('#margin'), marginOut: $('#margin-out'), exportSize: $('#export-size'),
  logoZone: $('#logo-zone'), logoFile: $('#logo-file'), logoThumb: $('#logo-thumb'), logoPickLabel: $('#logo-pick-label'),
  logoRemove: $('#logo-remove'), logoOptions: $('#logo-options'), logoSize: $('#logo-size'), logoSizeOut: $('#logo-size-out'), logoPlate: $('#logo-plate'),
};

const type = () => TYPES.find((t) => t.id === typeId);
const persist = () => storage.set('qr', { type: typeId, style });

// ---------- content form ----------

function renderTypes() {
  el.types.innerHTML = TYPES.map((t) => `<label class="type-chip"><input type="radio" name="type" value="${t.id}"${t.id === typeId ? ' checked' : ''}><span>${icon(t.icon)}${t.label}</span></label>`).join('');
}

function fieldHTML(f, v) {
  const id = `f-${f.k}`;
  const cls = `form-field${f.span ? ' span-2' : ''}`;
  const val = escapeHTML(v ?? f.value ?? '');
  switch (f.type) {
    case 'textarea':
      return `<label class="${cls}"><span class="form-label">${f.label}</span><textarea class="input" id="${id}" data-k="${f.k}" rows="3" spellcheck="false"${f.ph ? ` placeholder="${escapeHTML(f.ph)}"` : ''}>${val}</textarea></label>`;
    case 'select':
      return `<label class="${cls}"><span class="form-label">${f.label}</span><select class="select" id="${id}" data-k="${f.k}">${f.options.map(([o, l]) => `<option value="${o}"${(v ?? f.value) === o ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`;
    case 'switch':
      return `<div class="${cls}"><label class="switch"><input type="checkbox" role="switch" id="${id}" data-k="${f.k}"${v ? ' checked' : ''}><span class="switch-track"></span><span>${f.label}</span></label></div>`;
    case 'segmented':
      return `<div class="${cls}"><span class="form-label">${f.label}</span><div class="segmented" role="radiogroup">${f.options.map(([o, l]) => `<label><input type="radio" name="${id}" value="${o}" data-k="${f.k}"${(v ?? f.value) === o ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div></div>`;
    default:
      return `<label class="${cls}"><span class="form-label">${f.label}</span><input class="input${f.mono ? ' input-mono' : ''}" id="${id}" data-k="${f.k}" type="${f.type || 'text'}" value="${val}"${f.ph ? ` placeholder="${escapeHTML(f.ph)}"` : ''}${f.step ? ` step="${f.step}"` : ''} spellcheck="false" autocapitalize="off"></label>`;
  }
}

function renderForm() {
  const t = type();
  values[t.id] ??= Object.fromEntries(t.fields.filter((f) => f.value !== undefined).map((f) => [f.k, f.value]));
  el.typeHint.textContent = t.hint;
  el.form.innerHTML = t.fields.map((f) => fieldHTML(f, values[t.id][f.k])).join('');
}

function readField(input) {
  if (input.type === 'checkbox') return input.checked;
  if (input.type === 'radio') return input.checked ? input.value : undefined;
  return input.value;
}

// "Empty" ignores fields that always carry a default (selects, switches, format).
function isEmpty(t, v) {
  return t.fields.every((f) => ['select', 'switch', 'segmented'].includes(f.type) || !String(v[f.k] ?? '').trim());
}

// ---------- generate + preview ----------

function effectiveEcc() { return logo ? 'H' : style.ecc; }

function generate() {
  const id = ++genId;
  const t = type();
  const v = values[t.id] || {};
  el.contentMessages.innerHTML = '';
  el.previewMessages.innerHTML = '';
  current = null;

  if (isEmpty(t, v)) return showEmpty('Fill in the content to generate a code.');
  let text;
  try {
    ({ text } = t.build(v));
  } catch (err) {
    el.contentMessages.innerHTML = alertHTML('info', err.message);
    return showEmpty('Finish the details on the left to see your code.');
  }
  let qr;
  try {
    qr = encodeQr(text, { ecc: effectiveEcc() });
  } catch (err) {
    el.contentMessages.innerHTML = alertHTML('error', err.message);
    return showEmpty('Too much content for one QR code.');
  }
  const lay = layout(qr, { margin: style.margin, style: style.module, logoRatio: logo ? style.logoSize / 100 : 0 });
  current = { qr, lay, text };

  const { scale, px } = canvasSizeFor(lay, 720);
  el.preview.width = px;
  el.preview.height = px;
  paintCanvas(el.preview.getContext('2d'), lay, { scale, ...paintOpts() });
  el.preview.setAttribute('aria-label', `QR code for: ${text.slice(0, 120)}`);
  el.empty.hidden = true;

  const boosted = qr.ecc !== qr.requestedEcc;
  el.meta.innerHTML = [
    `<span>Version <strong>${qr.version}</strong></span>`,
    `<span><strong>${qr.size}×${qr.size}</strong> modules</span>`,
    `<span>ECC <strong>${qr.ecc}</strong>${boosted ? ` (raised from ${qr.requestedEcc}, same size)` : ''}</span>`,
    `<span><strong>${qr.dataBytes}</strong> / ${qr.capacityBytes} bytes</span>`,
    '<span id="scan-status"></span>',
  ].join('');
  el.capacity.hidden = false;
  const fill = qr.dataBytes / qr.capacityBytes;
  el.capacityBar.style.width = `${Math.round(fill * 100)}%`;
  el.capacityBar.classList.toggle('is-high', qr.version >= 20);
  el.payload.textContent = text;

  el.previewMessages.innerHTML = warnings(qr).join('');
  setActions(true);
  scanCheck(id, text);
}

function showEmpty(message) {
  el.empty.hidden = false;
  el.empty.querySelector('p').textContent = message;
  el.meta.innerHTML = '';
  el.capacity.hidden = true;
  el.payload.textContent = '';
  setActions(false);
}

function setActions(on) {
  el.dlPng.disabled = !on;
  el.dlSvg.disabled = !on;
  el.copyImg.disabled = !on;
}

const paintOpts = () => ({
  fg: style.fg, bg: style.bg, transparent: style.transparent,
  logoImage: logo?.image || null, logoPlate: style.logoPlate,
});

function warnings(qr) {
  const out = [];
  const ratio = contrastRatio(style.fg, style.bg);
  if (!style.transparent && ratio < 3) {
    out.push(alertHTML('error', `Low contrast (${ratio.toFixed(1)}:1). Scanners need a clear difference between code and background. Aim for 4:1 or more.`));
  } else if (!style.transparent && ratio < 4.5) {
    out.push(alertHTML('warn', `Contrast is ${ratio.toFixed(1)}:1. Most phones cope, but darker modules on a lighter background scan best.`));
  }
  if (!style.transparent && isInverted(style.fg, style.bg)) {
    out.push(alertHTML('warn', 'Light code on a dark background. Many scanners, especially older ones, can’t read inverted codes.'));
  }
  if (style.margin < 2) out.push(alertHTML('warn', 'A quiet zone under 2 modules can stop phones from finding the code. Leave space around it when printing.'));
  if (style.transparent) out.push(alertHTML('info', 'Transparent background: place it on a surface that contrasts with the code color.'));
  if (qr.version >= 25) out.push(alertHTML('info', `This is a dense code (${qr.size}×${qr.size}). Print it larger, or shorten the content, for reliable scanning.`));
  return out;
}

// Self-check with the browser's own QR reader where available (Chrome on
// macOS, Android, ChromeOS). Draws onto an opaque canvas first so transparent
// pixels don't read as black.
const detectorPromise = (async () => {
  try {
    if (!('BarcodeDetector' in window)) return null;
    const formats = await window.BarcodeDetector.getSupportedFormats();
    return formats.includes('qr_code') ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
  } catch {
    return null;
  }
})();

const scanCheck = debounce(async (id, text) => {
  const detector = await detectorPromise;
  const host = $('#scan-status');
  if (!detector || !host || id !== genId) return;
  const c = document.createElement('canvas');
  c.width = el.preview.width;
  c.height = el.preview.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = style.transparent ? '#ffffff' : style.bg;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(el.preview, 0, 0);
  let ok = false;
  try {
    ok = (await detector.detect(c)).some((r) => r.rawValue === text);
  } catch { /* treat as unreadable */ }
  if (id !== genId) return;
  host.innerHTML = ok
    ? `<span class="badge badge-ok" title="Your browser’s built-in scanner read this code back correctly">${icon('check')} Scan check passed</span>`
    : `<span class="badge badge-danger" title="Your browser’s built-in scanner couldn’t read it">${icon('alert')} Scan check failed</span>`;
  if (!ok) {
    el.previewMessages.insertAdjacentHTML('afterbegin', alertHTML('error', 'Your browser couldn’t read this code back. Try more contrast, a smaller logo, higher error correction or the Square style.'));
  }
}, 150);

const generateSoon = debounce(generate, 80);

// ---------- style controls ----------

function syncStyleControls() {
  el.fg.value = style.fg; el.fgHex.value = style.fg;
  el.bg.value = style.bg; el.bgHex.value = style.bg;
  el.transparent.checked = style.transparent;
  el.modules.forEach((r) => { r.checked = r.value === style.module; });
  const ecc = effectiveEcc();
  el.eccs.forEach((r) => { r.checked = r.value === ecc; });
  el.eccGroup.classList.toggle('is-locked', !!logo);
  el.eccHint.textContent = logo
    ? 'Locked to H while a logo is shown, so the hidden part of the code can be recovered.'
    : `Recovers ${ECC_LEVELS[ecc].recovery} damage. Higher levels make the code denser.`;
  el.margin.value = style.margin;
  el.marginOut.textContent = `${style.margin}`;
  el.exportSize.value = String(style.exportSize);
  el.logoSize.value = style.logoSize;
  el.logoSizeOut.textContent = `${style.logoSize}%`;
  el.logoPlate.checked = style.logoPlate;
}

function setStyle(patch) {
  Object.assign(style, patch);
  persist();
  syncStyleControls();
  generate();
}

function colorInput(picker, hex, key) {
  picker.addEventListener('input', () => setStyle({ [key]: picker.value }));
  hex.addEventListener('input', () => {
    const v = hex.value.trim();
    const rgb = parseHex(v);
    hex.classList.toggle('is-invalid', !rgb);
    if (rgb) setStyle({ [key]: '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('') });
  });
  hex.addEventListener('blur', () => { hex.value = style[key]; hex.classList.remove('is-invalid'); });
}

// ---------- logo ----------

async function loadLogo(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('That file isn’t an image', 'error'); return; }
  if (file.size > 2 * 1024 * 1024) { toast(`Logo is ${formatBytes(file.size)}; use one under 2 MB`, 'error'); return; }
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  const image = new Image();
  image.src = dataUrl;
  try {
    await image.decode();
  } catch {
    toast('Couldn’t read that image', 'error');
    return;
  }
  logo = { dataUrl, image, name: file.name };
  el.logoThumb.src = dataUrl;
  el.logoThumb.hidden = false;
  el.logoRemove.hidden = false;
  el.logoOptions.hidden = false;
  el.logoPickLabel.textContent = 'Change logo';
  syncStyleControls();
  generate();
}

function removeLogo() {
  logo = null;
  el.logoThumb.hidden = true;
  el.logoThumb.removeAttribute('src');
  el.logoRemove.hidden = true;
  el.logoOptions.hidden = true;
  el.logoPickLabel.textContent = 'Add logo';
  syncStyleControls();
  generate();
}

// ---------- export ----------

const fileBase = () => `qr-${typeId}`;

function renderPngBlob() {
  const { scale, px } = canvasSizeFor(current.lay, style.exportSize);
  const c = document.createElement('canvas');
  c.width = px;
  c.height = px;
  paintCanvas(c.getContext('2d'), current.lay, { scale, ...paintOpts() });
  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}

el.dlPng.addEventListener('click', async () => {
  if (!current) return;
  downloadBlob(await renderPngBlob(), `${fileBase()}.png`, 'image/png');
});
el.dlSvg.addEventListener('click', () => {
  if (!current) return;
  const svg = toSvg(current.lay, { fg: style.fg, bg: style.bg, transparent: style.transparent, sizePx: style.exportSize, logoHref: logo?.dataUrl, logoPlate: style.logoPlate });
  downloadBlob(svg, `${fileBase()}.svg`, 'image/svg+xml');
});
// Image clipboard writes only exist in secure contexts.
if (window.isSecureContext && navigator.clipboard?.write && window.ClipboardItem) {
  el.copyImg.hidden = false;
  el.copyImg.addEventListener('click', async () => {
    if (!current) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': renderPngBlob() })]);
      toast('Image copied');
    } catch {
      toast('Couldn’t copy the image', 'error');
    }
  });
}

// ---------- wiring ----------

el.types.addEventListener('change', (e) => {
  typeId = e.target.value;
  persist();
  renderForm();
  generate();
});
el.form.addEventListener('input', (e) => {
  const k = e.target.dataset.k;
  if (!k) return;
  const v = readField(e.target);
  if (v !== undefined) values[typeId][k] = v;
  generateSoon();
});
el.form.addEventListener('change', (e) => {
  if (e.target.type === 'radio' || e.target.type === 'checkbox' || e.target.tagName === 'SELECT') {
    values[typeId][e.target.dataset.k] = readField(e.target) ?? values[typeId][e.target.dataset.k];
    generate();
  }
});
el.form.addEventListener('submit', (e) => e.preventDefault());

colorInput(el.fg, el.fgHex, 'fg');
colorInput(el.bg, el.bgHex, 'bg');
$('#swap-colors').addEventListener('click', () => setStyle({ fg: style.bg, bg: style.fg }));
el.transparent.addEventListener('change', () => setStyle({ transparent: el.transparent.checked }));
el.modules.forEach((r) => r.addEventListener('change', () => setStyle({ module: r.value })));
el.eccs.forEach((r) => r.addEventListener('change', () => setStyle({ ecc: r.value })));
el.margin.addEventListener('input', () => setStyle({ margin: Number(el.margin.value) }));
el.exportSize.addEventListener('change', () => setStyle({ exportSize: Number(el.exportSize.value) }));
el.logoSize.addEventListener('input', () => setStyle({ logoSize: Number(el.logoSize.value) }));
el.logoPlate.addEventListener('change', () => setStyle({ logoPlate: el.logoPlate.checked }));
$('#reset-style').addEventListener('click', () => { setStyle({ ...DEFAULT_STYLE }); toast('Style reset'); });

$('#logo-pick').addEventListener('click', () => el.logoFile.click());
el.logoFile.addEventListener('change', () => { loadLogo(el.logoFile.files[0]); el.logoFile.value = ''; });
el.logoRemove.addEventListener('click', removeLogo);
el.logoZone.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); el.logoZone.classList.add('is-dragover'); } });
el.logoZone.addEventListener('dragleave', (e) => { if (!el.logoZone.contains(e.relatedTarget)) el.logoZone.classList.remove('is-dragover'); });
el.logoZone.addEventListener('drop', (e) => {
  if (!e.dataTransfer?.files.length) return;
  e.preventDefault();
  el.logoZone.classList.remove('is-dragover');
  loadLogo(e.dataTransfer.files[0]);
});

renderTypes();
renderForm();
syncStyleControls();
generate();
