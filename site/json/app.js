import { parseJson, formatAst, stats, codeFrame } from '/lib/json.js';
import { $, $$, storage, copyText, downloadBlob, formatBytes, alertHTML, codeErrorHTML, revealPosition, toast } from '/assets/ui.js';
import { icon } from '/assets/icons.js';

const el = {
  styles: $$('input[name=style]'),
  indent: $('#indent'),
  indentField: $('#indent-field'),
  sort: $('#opt-sort'),
  input: $('#input'),
  output: $('#output'),
  messages: $('#messages'),
  status: $('#status'),
  copy: $('#copy'),
  download: $('#download'),
  apply: $('#apply'),
  inputField: $('#input-field'),
  fileInput: $('#file'),
};

const SAMPLE = `{
  "service": "homelab-dns", "version": 3,
  "replicas": 2, "id": 18446744073709551615,
  "ports": [53, 853], "tags": ["infra","dns"],
  "upstreams": [{"host": "1.1.1.1", "tls": true}, {"host": "9.9.9.9", "tls": true}],
  "notes": null
}`;

const saved = storage.get('json', {});
const style = () => el.styles.find((r) => r.checked).value;
el.styles.forEach((r) => { r.checked = r.value === (saved.style || 'pretty'); });
el.indent.value = saved.indent || '2';
el.sort.checked = !!saved.sort;

let errorPos = null;

const persist = () => storage.set('json', { style: style(), indent: el.indent.value, sort: el.sort.checked });
const indentString = () => (style() === 'minify' ? '' : el.indent.value === 'tab' ? '\t' : ' '.repeat(Number(el.indent.value)));

function run() {
  const src = el.input.value;
  el.indentField.hidden = style() === 'minify';
  errorPos = null;
  if (!src.trim()) {
    el.output.value = '';
    el.messages.innerHTML = '';
    el.status.innerHTML = '<span class="status-item">Paste JSON to validate and format it.</span>';
    setEnabled(false);
    return;
  }
  let parsed;
  try {
    parsed = parseJson(src);
  } catch (err) {
    errorPos = err.pos;
    el.output.value = '';
    el.messages.innerHTML = codeErrorHTML(err.message, codeFrame(src, err.pos));
    el.status.innerHTML = `<span class="status-item"><span class="badge badge-danger">Invalid JSON</span></span>`;
    setEnabled(false);
    return;
  }
  const out = formatAst(parsed.ast, { indent: indentString(), sortKeys: el.sort.checked });
  el.output.value = out;
  const w = parsed.warnings;
  el.messages.innerHTML = w.slice(0, 5).map((x) => alertHTML('warn', x.message)).join('') +
    (w.length > 5 ? alertHTML('warn', `…and ${w.length - 5} more warnings.`) : '');
  const s = stats(parsed.ast);
  el.status.innerHTML = [
    `<span class="status-item"><span class="badge badge-ok">${icon('check')} Valid JSON</span></span>`,
    `<span class="status-item">${s.keys.toLocaleString()} keys · ${(s.objects + s.arrays).toLocaleString()} containers · depth ${s.depth}</span>`,
    `<span class="status-item status-hint">${formatBytes(new Blob([src]).size)} → ${formatBytes(new Blob([out]).size)}</span>`,
  ].join('');
  setEnabled(true);
}

function setEnabled(on) {
  el.copy.disabled = !on;
  el.download.disabled = !on;
  el.apply.disabled = !on;
}

// Bigger documents get a longer debounce so typing stays responsive.
let timer;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(run, el.input.value.length > 500_000 ? 400 : 120);
}

el.input.addEventListener('input', schedule);
el.styles.forEach((r) => r.addEventListener('change', () => { persist(); run(); }));
el.indent.addEventListener('change', () => { persist(); run(); });
el.sort.addEventListener('change', () => { persist(); run(); });
el.messages.addEventListener('click', (e) => {
  if (e.target.closest('[data-goto-error]') && errorPos !== null) revealPosition(el.input, errorPos);
});
$('#clear').addEventListener('click', () => { el.input.value = ''; run(); el.input.focus(); });
$('#sample').addEventListener('click', () => { el.input.value = SAMPLE; run(); });
el.copy.addEventListener('click', () => copyText(el.output.value, el.copy));
el.download.addEventListener('click', () => downloadBlob(el.output.value + '\n', style() === 'minify' ? 'data.min.json' : 'data.json', 'application/json'));
el.apply.addEventListener('click', () => { el.input.value = el.output.value; run(); toast('Input replaced with output'); });

async function loadFile(f) {
  if (!f) return;
  el.input.value = await f.text();
  run();
  toast(`Loaded ${f.name}`);
}
$('#open-file').addEventListener('click', () => el.fileInput.click());
el.fileInput.addEventListener('change', () => { loadFile(el.fileInput.files[0]); el.fileInput.value = ''; });
el.inputField.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); el.inputField.classList.add('is-dragover'); } });
el.inputField.addEventListener('dragleave', (e) => { if (!el.inputField.contains(e.relatedTarget)) el.inputField.classList.remove('is-dragover'); });
el.inputField.addEventListener('drop', (e) => {
  if (!e.dataTransfer?.files.length) return;
  e.preventDefault();
  el.inputField.classList.remove('is-dragover');
  loadFile(e.dataTransfer.files[0]);
});

run();
