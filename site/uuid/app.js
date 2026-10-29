import { uuidv4, uuidv7, formatUuid, parseUuid } from '/lib/uuid.js';
import { $, $$, storage, debounce, copyText, downloadBlob, kvRow, alertHTML } from '/assets/ui.js';

const el = {
  versions: $$('input[name=version]'),
  count: $('#count'),
  upper: $('#opt-upper'),
  noHyphens: $('#opt-nohyphens'),
  braces: $('#opt-braces'),
  output: $('#output'),
  hint: $('#version-hint'),
  inspect: $('#inspect'),
  inspectRows: $('#inspect-rows'),
  inspectMessages: $('#inspect-messages'),
};

const HINTS = {
  v4: '122 random bits. Use when order doesn’t matter.',
  v7: 'Unix-ms timestamp prefix. Sorts by creation time, which suits database keys.',
};

const saved = storage.get('uuid', {});
el.versions.forEach((r) => { r.checked = r.value === (saved.version || 'v4'); });
el.count.value = saved.count || 5;
el.upper.checked = !!saved.upper;
el.noHyphens.checked = !!saved.noHyphens;
el.braces.checked = !!saved.braces;

let raw = []; // canonical UUIDs; formatting is applied on display

const version = () => el.versions.find((r) => r.checked).value;
const count = () => Math.min(1000, Math.max(1, Math.floor(Number(el.count.value)) || 1));

function persist() {
  storage.set('uuid', {
    version: version(), count: count(),
    upper: el.upper.checked, noHyphens: el.noHyphens.checked, braces: el.braces.checked,
  });
}

function render() {
  const opts = { upper: el.upper.checked, hyphens: !el.noHyphens.checked, braces: el.braces.checked };
  el.output.value = raw.map((u) => formatUuid(u, opts)).join('\n');
  el.output.rows = Math.min(raw.length, 14);
  el.hint.textContent = HINTS[version()];
}

function generate() {
  const make = version() === 'v7' ? uuidv7 : uuidv4;
  raw = Array.from({ length: count() }, () => make());
  persist();
  render();
  if (!el.inspect.value) inspect(raw[0], true);
}

function inspect(value, preview = false) {
  el.inspectMessages.innerHTML = '';
  if (!value.trim()) { el.inspectRows.innerHTML = ''; return; }
  let info;
  try {
    info = parseUuid(value);
  } catch (err) {
    el.inspectRows.innerHTML = '';
    el.inspectMessages.innerHTML = alertHTML('error', err.message);
    return;
  }
  const rows = [kvRow('Canonical', info.canonical)];
  if (info.special) {
    rows.push(kvRow('Type', info.variant, { plain: true, copy: false }));
  } else {
    rows.push(kvRow('Version', `${info.version} · ${info.versionName}`, { plain: true, copy: false }));
    rows.push(kvRow('Variant', info.variant, { plain: true, copy: false }));
    if (info.timestamp) {
      rows.push(kvRow('Timestamp', info.timestamp.toISOString(), { sub: 'UTC' }));
      rows.push(kvRow('Local time', info.timestamp.toLocaleString(), { plain: true }));
    }
    if (info.node) rows.push(kvRow('Node', info.node, { sub: 'MAC or random' }));
  }
  el.inspectRows.innerHTML = rows.join('');
  if (preview) el.inspect.placeholder = `Paste any UUID. Showing the first generated one: ${info.canonical}`;
}

el.versions.forEach((r) => r.addEventListener('change', generate));
el.count.addEventListener('input', debounce(generate, 250));
[el.upper, el.noHyphens, el.braces].forEach((cb) => cb.addEventListener('change', () => { persist(); render(); }));
$('#generate').addEventListener('click', generate);
$('#copy').addEventListener('click', (e) => copyText(el.output.value, e.currentTarget));
$('#download').addEventListener('click', () => downloadBlob(el.output.value + '\n', `uuids-${version()}.txt`, 'text/plain'));
el.inspect.addEventListener('input', () => inspect(el.inspect.value));

generate();
