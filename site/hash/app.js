import { ALGORITHMS, hashBytes, toHex, normalizeDigest } from '/lib/hash.js';
import { bytesToBase64 } from '/lib/base64.js';
import { $, $$, storage, debounce, kvRow, alertHTML, formatBytes, readFileBytes } from '/assets/ui.js';

const el = {
  sources: $$('input[name=source]'),
  format: $('#format'),
  text: $('#text'),
  textField: $('#text-field'),
  fileField: $('#file-field'),
  fileInput: $('#file'),
  fileName: $('#file-name'),
  fileMeta: $('#file-meta'),
  drop: $('#drop'),
  digests: $('#digests'),
  meta: $('#meta'),
  compare: $('#compare'),
  compareResult: $('#compare-result'),
};

const saved = storage.get('hash', {});
el.format.value = saved.format || 'hex';

let source = 'text';
let file = null;       // { name, size, bytes }
let results = null;    // { [alg]: Uint8Array }
let runId = 0;

const display = (bytes) => {
  const f = el.format.value;
  return f === 'base64' ? bytesToBase64(bytes) : toHex(bytes, f === 'HEX');
};

async function compute() {
  const id = ++runId;
  let bytes;
  if (source === 'text' && el.text.value) {
    bytes = new TextEncoder().encode(el.text.value);
  } else if (source === 'file' && file) {
    bytes = file.bytes;
  } else {
    results = null;
    render();
    return;
  }
  const started = performance.now();
  if (bytes.length > 20 * 1024 * 1024) el.meta.textContent = 'Hashing…';
  const out = {};
  for (const a of ALGORITHMS) out[a.id] = await hashBytes(a.id, bytes);
  if (id !== runId) return; // a newer input superseded this run
  results = out;
  const ms = Math.round(performance.now() - started);
  el.meta.textContent = `${formatBytes(bytes.length)} hashed${ms > 50 ? ` in ${ms} ms` : ''}`;
  render();
}

function render() {
  const expected = normalizeDigest(el.compare.value);
  el.digests.innerHTML = ALGORITHMS.map((a) => {
    const v = results ? display(results[a.id]) : '';
    const match = expected && results && toHex(results[a.id]) === expected;
    const badge = a.insecure ? ' <span class="badge badge-warn">Not for security</span>' : '';
    return kvRow(a.label, v, { sub: `${a.bits}-bit`, badge, cls: match ? 'is-match' : '' });
  }).join('');
  if (!results) el.meta.textContent = source === 'file' ? 'Choose a file to hash' : '';

  if (!el.compare.value.trim()) { el.compareResult.innerHTML = ''; return; }
  if (!expected) {
    el.compareResult.innerHTML = alertHTML('error', 'That doesn’t look like a hash. Paste hex digits or Base64.');
    return;
  }
  if (!results) { el.compareResult.innerHTML = ''; return; }
  const hit = ALGORITHMS.find((a) => toHex(results[a.id]) === expected);
  el.compareResult.innerHTML = hit
    ? alertHTML('ok', `Match: the input’s ${hit.label} equals the expected hash.${hit.insecure ? ' MD5 cannot prove the file wasn’t tampered with; compare a SHA-256 if one is published.' : ''}`)
    : alertHTML('warn', `No match. The expected hash is ${expected.length * 4}-bit${[128, 256, 384, 512].includes(expected.length * 4) ? '' : ', which is not the length of any digest here'}. Check you have the right file and algorithm.`);
}

async function loadFile(f) {
  if (!f) return;
  el.fileName.textContent = f.name;
  el.fileMeta.textContent = `${formatBytes(f.size)} · reading…`;
  file = { name: f.name, size: f.size, bytes: await readFileBytes(f) };
  el.fileMeta.textContent = `${formatBytes(f.size)}${f.type ? ' · ' + f.type : ''}`;
  $('#choose').lastChild.textContent = 'Choose another';
  compute();
}

el.sources.forEach((r) => r.addEventListener('change', () => {
  source = r.value;
  el.textField.hidden = source !== 'text';
  el.fileField.hidden = source !== 'file';
  compute();
}));
el.text.addEventListener('input', debounce(compute, 100));
el.format.addEventListener('change', () => { storage.set('hash', { format: el.format.value }); render(); });
el.compare.addEventListener('input', render);
$('#choose').addEventListener('click', () => el.fileInput.click());
el.fileInput.addEventListener('change', () => { loadFile(el.fileInput.files[0]); el.fileInput.value = ''; });

// Dropping a file anywhere on the page switches to file mode.
let depth = 0;
const hasFiles = (e) => e.dataTransfer?.types.includes('Files');
document.addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; el.drop.parentElement.classList.add('is-dragover'); } });
document.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; el.drop.parentElement.classList.remove('is-dragover'); } });
document.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  if (!e.dataTransfer?.files.length) return;
  e.preventDefault();
  depth = 0;
  el.drop.parentElement.classList.remove('is-dragover');
  el.sources.find((r) => r.value === 'file').click();
  loadFile(e.dataTransfer.files[0]);
});

compute();
