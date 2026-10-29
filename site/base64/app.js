import { bytesToBase64, base64ToBytes, utf8OrNull } from '/lib/base64.js';
import { $, $$, storage, debounce, copyText, downloadBlob, formatBytes, formatCount, readFileBytes, toast } from '/assets/ui.js';
import { icon } from '/assets/icons.js';

const el = {
  modes: $$('input[name=mode]'),
  encodeOptions: $('#encode-options'),
  urlSafe: $('#opt-urlsafe'),
  noPad: $('#opt-nopad'),
  dataUri: $('#opt-datauri'),
  inputField: $('#input-field'),
  input: $('#input'),
  inputLabel: $('#input-label'),
  output: $('#output'),
  outputLabel: $('#output-label'),
  fileInput: $('#file'),
  fileCard: $('#file-card'),
  fileName: $('#file-name'),
  fileMeta: $('#file-meta'),
  binaryCard: $('#binary-card'),
  binaryMeta: $('#binary-meta'),
  status: $('#status'),
  copy: $('#copy'),
  download: $('#download'),
  swap: $('#swap'),
};

const saved = storage.get('base64', {});
const state = {
  mode: saved.mode === 'decode' ? 'decode' : 'encode',
  file: null,      // { name, type, bytes } when encoding a file
  decoded: null,   // Uint8Array result of the last successful decode
};
el.urlSafe.checked = !!saved.urlSafe;
el.noPad.checked = !!saved.noPad;
el.dataUri.checked = !!saved.dataUri;
el.modes.forEach((r) => { r.checked = r.value === state.mode; });

function persist() {
  storage.set('base64', {
    mode: state.mode,
    urlSafe: el.urlSafe.checked,
    noPad: el.noPad.checked,
    dataUri: el.dataUri.checked,
  });
}

function setStatus(items, error) {
  if (error) {
    el.status.innerHTML = `<span class="alert alert-error">${icon('alert')}<span></span></span>`;
    el.status.querySelector('.alert span').textContent = error;
    return;
  }
  el.status.innerHTML = items.length
    ? items.map((t) => `<span class="status-item">${t}</span>`).join('')
    : '<span class="status-item">Tip: drop a file onto the input to encode it.</span>';
}

function syncChrome() {
  const encoding = state.mode === 'encode';
  el.encodeOptions.hidden = !encoding;
  el.inputLabel.textContent = encoding ? 'Text' : 'Base64';
  el.outputLabel.textContent = encoding ? 'Base64' : 'Text';
  el.input.placeholder = encoding
    ? 'Type or paste text, or drop a file here…'
    : 'Paste Base64 (standard, URL-safe or a data: URI)…';
  el.fileCard.hidden = !state.file;
  el.input.hidden = !!state.file;
  if (state.file) {
    el.fileName.textContent = state.file.name;
    el.fileMeta.textContent = `${formatBytes(state.file.bytes.length)}${state.file.type ? ' · ' + state.file.type : ''}`;
  }
}

function run() {
  state.decoded = null;
  el.binaryCard.hidden = true;
  el.output.hidden = false;

  if (state.mode === 'encode') {
    const bytes = state.file ? state.file.bytes : new TextEncoder().encode(el.input.value);
    if (!state.file && !el.input.value) return finish('', []);
    let out = bytesToBase64(bytes, { urlSafe: el.urlSafe.checked, pad: !el.noPad.checked });
    if (el.dataUri.checked) {
      const type = state.file ? (state.file.type || 'application/octet-stream') : 'text/plain;charset=utf-8';
      out = `data:${type};base64,${out}`;
    }
    return finish(out, [
      `${formatBytes(bytes.length)} in`,
      `${formatCount(out.length, 'char')} out`,
      `+${bytes.length ? Math.round((out.length / bytes.length - 1) * 100) : 0}% size`,
    ]);
  }

  const raw = el.input.value;
  if (!raw.trim()) return finish('', []);
  let bytes;
  try {
    bytes = base64ToBytes(raw);
  } catch (err) {
    return finish('', [], err.message);
  }
  state.decoded = bytes;
  const text = utf8OrNull(bytes);
  if (text === null) {
    el.output.hidden = true;
    el.binaryCard.hidden = false;
    el.binaryMeta.textContent = `${formatBytes(bytes.length)} · not valid UTF-8 text`;
    return finish('', [`${formatCount(raw.length, 'char')} in`, `${formatBytes(bytes.length)} binary out`]);
  }
  return finish(text, [`${formatCount(raw.length, 'char')} in`, `${formatBytes(bytes.length)} out`]);
}

function finish(output, statusItems, error) {
  el.output.value = output;
  setStatus(statusItems, error);
  const hasOutput = output.length > 0 || !!state.decoded?.length;
  el.copy.disabled = !output;
  el.download.disabled = !hasOutput;
  el.swap.disabled = !output;
}

const runSoon = debounce(run, 60);

// ---------- events ----------

el.modes.forEach((radio) => radio.addEventListener('change', () => {
  state.mode = radio.value;
  if (state.mode === 'decode') state.file = null;
  persist();
  syncChrome();
  run();
}));

[el.urlSafe, el.noPad, el.dataUri].forEach((cb) => cb.addEventListener('change', () => { persist(); run(); }));
el.input.addEventListener('input', runSoon);

$('#clear').addEventListener('click', () => {
  state.file = null;
  el.input.value = '';
  syncChrome();
  run();
  el.input.focus();
});

$('#remove-file').addEventListener('click', () => {
  state.file = null;
  syncChrome();
  run();
  el.input.focus();
});

el.swap.addEventListener('click', () => {
  if (!el.output.value) return;
  const next = el.output.value;
  state.mode = state.mode === 'encode' ? 'decode' : 'encode';
  state.file = null;
  el.modes.forEach((r) => { r.checked = r.value === state.mode; });
  el.input.value = next;
  persist();
  syncChrome();
  run();
});

el.copy.addEventListener('click', () => copyText(el.output.value, el.copy));

function downloadResult() {
  if (state.mode === 'encode') {
    const base = state.file ? state.file.name : 'text';
    downloadBlob(el.output.value, `${base}.b64.txt`, 'text/plain');
  } else if (state.decoded) {
    const isText = !el.output.hidden;
    downloadBlob(state.decoded, isText ? 'decoded.txt' : 'decoded.bin', isText ? 'text/plain' : 'application/octet-stream');
  }
}
el.download.addEventListener('click', downloadResult);
$('#download-binary').addEventListener('click', downloadResult);

// ---------- files: picker + drag and drop ----------

async function loadFile(file) {
  if (!file) return;
  if (state.mode === 'encode') {
    state.file = { name: file.name, type: file.type, bytes: await readFileBytes(file) };
  } else {
    el.input.value = await file.text();
  }
  syncChrome();
  run();
  toast(`Loaded ${file.name}`);
}

$('#open-file').addEventListener('click', () => el.fileInput.click());
el.fileInput.addEventListener('change', () => {
  loadFile(el.fileInput.files[0]);
  el.fileInput.value = '';
});

let dragDepth = 0;
el.inputField.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  dragDepth++;
  el.inputField.classList.add('is-dragover');
});
el.inputField.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
});
el.inputField.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) { dragDepth = 0; el.inputField.classList.remove('is-dragover'); }
});
el.inputField.addEventListener('drop', (e) => {
  if (!e.dataTransfer?.files.length) return;
  e.preventDefault();
  dragDepth = 0;
  el.inputField.classList.remove('is-dragover');
  loadFile(e.dataTransfer.files[0]);
});

syncChrome();
run();
