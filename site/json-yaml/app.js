import { jsonToYaml, yamlToJson } from '/lib/yaml.js';
import { codeFrame, posFromLineCol } from '/lib/json.js';
import { $, $$, storage, copyText, downloadBlob, alertHTML, codeErrorHTML, revealPosition, toast, formatCount } from '/assets/ui.js';
import { icon } from '/assets/icons.js';

const el = {
  dirs: $$('input[name=dir]'),
  indent: $('#indent'),
  sort: $('#opt-sort'),
  sortField: $('#sort-field'),
  input: $('#input'),
  output: $('#output'),
  inputLabel: $('#input-label'),
  outputLabel: $('#output-label'),
  messages: $('#messages'),
  status: $('#status'),
  copy: $('#copy'),
  download: $('#download'),
  swap: $('#swap'),
  inputField: $('#input-field'),
  fileInput: $('#file'),
};

const SAMPLES = {
  json2yaml: '{"services":{"pihole":{"image":"pihole/pihole:latest","ports":["53:53/udp","8080:80"],"environment":{"TZ":"America/New_York"},"restart":"unless-stopped"}}}',
  yaml2json: `# Two documents in one file
apiVersion: v1
kind: ConfigMap
metadata:
  name: homelab
data:
  greeting: "hello"
  replicas: 3
---
apiVersion: v1
kind: Namespace
metadata:
  name: tools
`,
};

const saved = storage.get('json-yaml', {});
let dir = saved.dir === 'yaml2json' ? 'yaml2json' : 'json2yaml';
el.dirs.forEach((r) => { r.checked = r.value === dir; });
el.indent.value = saved.indent || '2';
el.sort.checked = !!saved.sort;
let errorPos = null;

const persist = () => storage.set('json-yaml', { dir, indent: el.indent.value, sort: el.sort.checked });

function syncChrome() {
  const toYaml = dir === 'json2yaml';
  el.inputLabel.textContent = toYaml ? 'JSON' : 'YAML';
  el.outputLabel.textContent = toYaml ? 'YAML' : 'JSON';
  el.sortField.hidden = !toYaml;
  el.input.placeholder = toYaml ? 'Paste JSON…' : 'Paste YAML…';
}

function run() {
  const src = el.input.value;
  errorPos = null;
  el.messages.innerHTML = '';
  if (!src.trim()) {
    el.output.value = '';
    el.status.innerHTML = '';
    setEnabled(false);
    return;
  }
  const indent = Number(el.indent.value);
  try {
    if (dir === 'json2yaml') {
      const r = jsonToYaml(src, { indent, sortKeys: el.sort.checked });
      el.output.value = r.output;
      el.messages.innerHTML = r.warnings.map((w) => alertHTML('warn', w.message)).join('');
      el.status.innerHTML = `<span class="status-item"><span class="badge badge-ok">${icon('check')} Converted</span></span>`;
    } else {
      const r = yamlToJson(src, { indent });
      el.output.value = r.output;
      if (r.documents > 1) el.messages.innerHTML = alertHTML('info', `${formatCount(r.documents, 'YAML document')} found; the JSON output is an array with one entry per document.`);
      el.status.innerHTML = `<span class="status-item"><span class="badge badge-ok">${icon('check')} Converted</span></span>`;
    }
    setEnabled(true);
  } catch (err) {
    el.output.value = '';
    setEnabled(false);
    el.status.innerHTML = `<span class="status-item"><span class="badge badge-danger">Invalid ${dir === 'json2yaml' ? 'JSON' : 'YAML'}</span></span>`;
    if (err.line) {
      errorPos = posFromLineCol(src, err.line, err.column);
      el.messages.innerHTML = codeErrorHTML(capitalize(err.message), codeFrame(src, errorPos));
    } else {
      el.messages.innerHTML = alertHTML('error', capitalize(err.message));
    }
  }
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function setEnabled(on) {
  el.copy.disabled = !on;
  el.download.disabled = !on;
  el.swap.disabled = !on;
}

let timer;
el.input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 150); });
el.dirs.forEach((r) => r.addEventListener('change', () => { dir = r.value; persist(); syncChrome(); run(); }));
el.indent.addEventListener('change', () => { persist(); run(); });
el.sort.addEventListener('change', () => { persist(); run(); });
el.messages.addEventListener('click', (e) => {
  if (e.target.closest('[data-goto-error]') && errorPos !== null) revealPosition(el.input, errorPos);
});
$('#clear').addEventListener('click', () => { el.input.value = ''; run(); el.input.focus(); });
$('#sample').addEventListener('click', () => { el.input.value = SAMPLES[dir]; run(); });
el.copy.addEventListener('click', () => copyText(el.output.value, el.copy));
el.download.addEventListener('click', () => {
  const yaml = dir === 'json2yaml';
  downloadBlob(el.output.value, yaml ? 'data.yaml' : 'data.json', yaml ? 'text/yaml' : 'application/json');
});
el.swap.addEventListener('click', () => {
  el.input.value = el.output.value;
  dir = dir === 'json2yaml' ? 'yaml2json' : 'json2yaml';
  el.dirs.forEach((r) => { r.checked = r.value === dir; });
  persist();
  syncChrome();
  run();
});

async function loadFile(f) {
  if (!f) return;
  const text = await f.text();
  // Pick the direction from the file type.
  const isYaml = /\.ya?ml$/i.test(f.name);
  const isJson = /\.json$/i.test(f.name);
  if ((isYaml && dir !== 'yaml2json') || (isJson && dir !== 'json2yaml')) {
    dir = isYaml ? 'yaml2json' : 'json2yaml';
    el.dirs.forEach((r) => { r.checked = r.value === dir; });
    persist();
    syncChrome();
  }
  el.input.value = text;
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

syncChrome();
run();
