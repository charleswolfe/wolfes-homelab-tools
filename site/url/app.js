import { ENCODE_MODES, encode, decode, parseUrl } from '/lib/url.js';
import { $, $$, storage, debounce, copyText, kvRow, escapeHTML, formatCount } from '/assets/ui.js';
import { icon } from '/assets/icons.js';

const el = {
  modes: $$('input[name=mode]'),
  encoding: $('#encoding'),
  encodingField: $('#encoding-field'),
  plusField: $('#plus-field'),
  plus: $('#opt-plus'),
  input: $('#input'),
  output: $('#output'),
  inputLabel: $('#input-label'),
  outputLabel: $('#output-label'),
  status: $('#status'),
  copy: $('#copy'),
  swap: $('#swap'),
  partsPanel: $('#parts-panel'),
  parts: $('#parts'),
  partsSource: $('#parts-source'),
  paramsWrap: $('#params-wrap'),
  params: $('#params'),
  paramsCount: $('#params-count'),
};

el.encoding.innerHTML = ENCODE_MODES.map((m) => `<option value="${m.id}">${m.label}</option>`).join('');

const saved = storage.get('url', {});
let mode = saved.mode === 'decode' ? 'decode' : 'encode';
el.encoding.value = ENCODE_MODES.some((m) => m.id === saved.encoding) ? saved.encoding : 'component';
el.plus.checked = saved.plus ?? true;
el.modes.forEach((r) => { r.checked = r.value === mode; });

const persist = () => storage.set('url', { mode, encoding: el.encoding.value, plus: el.plus.checked });

function syncChrome() {
  const enc = mode === 'encode';
  el.encodingField.hidden = !enc;
  el.plusField.hidden = enc;
  el.inputLabel.textContent = enc ? 'Text' : 'Encoded';
  el.outputLabel.textContent = enc ? 'Encoded' : 'Decoded';
  el.input.placeholder = enc ? 'Text or a URL to encode…' : 'Percent-encoded text, e.g. caf%C3%A9%20au%20lait';
}

function setStatus(html) { el.status.innerHTML = html; }

function run() {
  const input = el.input.value;
  let out = '';
  if (input) {
    try {
      out = mode === 'encode' ? encode(input, el.encoding.value) : decode(input, { plusAsSpace: el.plus.checked });
      const hint = mode === 'encode' ? ENCODE_MODES.find((m) => m.id === el.encoding.value).hint : 'Decoding accepts any percent-encoded UTF-8.';
      setStatus(`<span class="status-item">${formatCount(input.length, 'char')} → ${formatCount(out.length, 'char')}</span><span class="status-item status-hint">${escapeHTML(hint)}</span>`);
    } catch (err) {
      setStatus(`<span class="alert alert-error">${icon('alert')}<span>${escapeHTML(err.message)}</span></span>`);
    }
  } else {
    setStatus(`<span class="status-item">${escapeHTML(ENCODE_MODES.find((m) => m.id === el.encoding.value).hint)}</span>`);
  }
  el.output.value = out;
  el.copy.disabled = !out;
  el.swap.disabled = !out;
  // Break down whichever side is the readable URL.
  renderParts(mode === 'encode' ? input : out, mode === 'encode' ? 'from input' : 'from decoded output');
}

function renderParts(text, source) {
  const p = text ? parseUrl(text) : null;
  el.partsPanel.hidden = !p;
  if (!p) return;
  el.partsSource.textContent = source;
  const rows = [
    ['Protocol', p.protocol], ['Origin', p.origin], ['Username', p.username], ['Password', p.password],
    ['Host', p.hostname], ['Port', p.port], ['Path', decodeSafe(p.pathname)], ['Query', p.search], ['Fragment', p.hash],
  ].filter(([, v]) => v);
  el.parts.innerHTML = rows.map(([k, v]) => kvRow(k, v)).join('');
  el.paramsWrap.hidden = !p.params.length;
  el.paramsCount.textContent = formatCount(p.params.length, 'parameter');
  el.params.innerHTML = p.params.map(([k, v], i) =>
    `<tr><td class="num">${i + 1}</td><td>${escapeHTML(k)}</td><td>${v ? escapeHTML(v) : '<span class="null">empty</span>'}</td></tr>`).join('');
}

function decodeSafe(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

const runSoon = debounce(run, 60);

el.modes.forEach((r) => r.addEventListener('change', () => { mode = r.value; persist(); syncChrome(); run(); }));
el.encoding.addEventListener('change', () => { persist(); run(); });
el.plus.addEventListener('change', () => { persist(); run(); });
el.input.addEventListener('input', runSoon);
$('#clear').addEventListener('click', () => { el.input.value = ''; run(); el.input.focus(); });
el.copy.addEventListener('click', () => copyText(el.output.value, el.copy));
el.swap.addEventListener('click', () => {
  el.input.value = el.output.value;
  mode = mode === 'encode' ? 'decode' : 'encode';
  el.modes.forEach((r) => { r.checked = r.value === mode; });
  persist();
  syncChrome();
  run();
});

syncChrome();
run();
