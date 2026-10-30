import { OUTPUT_FORMATS, sniffFormat, svgSize, targetSize, downscaleSteps, outputName, sizeChange, makeZip } from '/lib/image.js';
import { $, $$, storage, debounce, downloadBlob, formatBytes, formatCount, escapeHTML, toast } from '/assets/ui.js';
import { icon } from '/assets/icons.js';

const el = {
  drop: $('#drop'),
  dropZone: $('#drop-zone'),
  file: $('#file'),
  formats: $('#formats'),
  quality: $('#quality'),
  qualityOut: $('#quality-out'),
  qualityField: $('#quality-field'),
  resize: $('#resize'),
  scale: $('#scale'),
  scaleField: $('#scale-field'),
  maxWidth: $('#max-width'),
  maxHeight: $('#max-height'),
  fitField: $('#fit-field'),
  bg: $('#bg'),
  bgField: $('#bg-field'),
  hint: $('#options-hint'),
  panel: $('#results-panel'),
  results: $('#results'),
  totals: $('#totals'),
  downloadAll: $('#download-all'),
};

// ---------- which formats this browser can encode ----------

// canvas.toBlob quietly falls back to PNG for a type it can't encode, so a
// format is supported only if the blob comes back with that type.
async function canEncode(mime) {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const blob = await new Promise((r) => c.toBlob(r, mime));
  return blob?.type === mime;
}
const supported = Object.fromEntries(await Promise.all(OUTPUT_FORMATS.map(async (f) => [f.id, await canEncode(f.mime)])));

el.formats.innerHTML = OUTPUT_FORMATS.map((f) => `<label${supported[f.id] ? '' : ' title="This browser can’t encode ' + f.label + '"'}>
  <input type="radio" name="format" value="${f.id}"${supported[f.id] ? '' : ' disabled'}><span>${f.label}</span></label>`).join('');

// ---------- settings ----------

const DEFAULTS = { format: 'webp', quality: 85, resize: 'original', scale: 50, maxWidth: 1920, maxHeight: 1920, bg: '#ffffff' };
const s = { ...DEFAULTS, ...storage.get('image', {}) };
if (!supported[s.format]) s.format = supported.webp ? 'webp' : 'png';
$$('input[name=format]').forEach((r) => { r.checked = r.value === s.format; });
el.quality.value = s.quality;
el.resize.value = s.resize;
el.scale.value = s.scale;
el.maxWidth.value = s.maxWidth || '';
el.maxHeight.value = s.maxHeight || '';
el.bg.value = s.bg;

const format = () => OUTPUT_FORMATS.find((f) => f.id === $('input[name=format]:checked').value);
const resizeOpts = () => ({
  mode: el.resize.value,
  scale: Math.min(400, Math.max(1, Number(el.scale.value) || 100)),
  maxWidth: Number(el.maxWidth.value) || 0,
  maxHeight: Number(el.maxHeight.value) || 0,
});

function persist() {
  const r = resizeOpts();
  storage.set('image', { format: format().id, quality: Number(el.quality.value), resize: r.mode, scale: r.scale, maxWidth: r.maxWidth, maxHeight: r.maxHeight, bg: el.bg.value });
}

function syncOptions() {
  const f = format();
  el.qualityField.hidden = !f.lossy;
  el.qualityOut.value = el.quality.value;
  el.scaleField.hidden = el.resize.value !== 'scale';
  el.fitField.hidden = el.resize.value !== 'fit';
  el.bgField.hidden = f.alpha;
  const notes = [];
  if (!f.lossy) notes.push('PNG is lossless, so there’s no quality setting; it’s usually the largest format for photos.');
  if (!f.alpha) notes.push('JPEG has no transparency; transparent areas are filled with the background colour.');
  const missing = OUTPUT_FORMATS.filter((x) => !supported[x.id]).map((x) => x.label);
  if (missing.length) notes.push(`This browser can’t encode ${missing.join(' or ')}.`);
  el.hint.textContent = notes.join(' ');
}

// ---------- images ----------

let items = [];
let nextId = 1;
let generation = 0;

async function decode(file) {
  const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  const kind = sniffFormat(head);
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    const what = kind ? `${kind} image` : 'file';
    throw new Error(kind
      ? `This browser can’t open this ${what}.${kind === 'HEIC' ? ' Safari can; elsewhere, export it from Photos as JPEG first.' : ''}`
      : 'Not an image this browser can open.');
  }
  let width = img.naturalWidth;
  let height = img.naturalHeight;
  const vector = kind === 'SVG';
  if (vector) ({ width, height } = svgSize(await file.text()));
  return { img, url, vector, kind: kind || file.type.replace('image/', '').toUpperCase() || 'Image', width, height };
}

// Vectors are drawn straight at the target size, which renders them sharp at
// any scale; bitmaps step down by halves first.
function drawScaled(source, fromW, fromH, toW, toH, vector = false) {
  let cur = source;
  let canvas;
  for (const step of vector ? [{ width: toW, height: toH }] : downscaleSteps(fromW, fromH, toW, toH)) {
    canvas = document.createElement('canvas');
    canvas.width = step.width;
    canvas.height = step.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Too large for this browser to process. Choose a smaller size.');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, step.width, step.height);
    cur = canvas;
  }
  return canvas;
}

async function encode(item, gen) {
  const f = format();
  const { width, height } = targetSize(item.width, item.height, resizeOpts());
  let canvas = drawScaled(item.img, item.width, item.height, width, height, item.vector);
  if (!f.alpha) {
    const flat = document.createElement('canvas');
    flat.width = width;
    flat.height = height;
    const ctx = flat.getContext('2d');
    ctx.fillStyle = el.bg.value;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(canvas, 0, 0);
    canvas = flat;
  }
  const blob = await new Promise((r) => canvas.toBlob(r, f.mime, f.lossy ? Number(el.quality.value) / 100 : undefined));
  canvas.width = canvas.height = 0; // release the pixel memory now rather than at GC
  if (gen !== generation) return;
  if (!blob || blob.type !== f.mime) throw new Error('The browser couldn’t encode this image at that size. Choose a smaller size.');
  if (item.out?.url) URL.revokeObjectURL(item.out.url);
  item.out = { blob, url: URL.createObjectURL(blob), width, height, format: f };
}

// Re-encode every image with the current settings. A newer run cancels an
// older one, so dragging the quality slider never queues up stale work.
async function convertAll() {
  const gen = ++generation;
  for (const item of items) item.busy = !item.error;
  render();
  for (const item of items) {
    if (gen !== generation) return;
    if (item.error) continue;
    try {
      await encode(item, gen);
      item.encodeError = null;
    } catch (err) {
      item.encodeError = err.message;
      item.out = null;
    }
    item.busy = false;
    render();
  }
}

async function addFiles(files) {
  const list = [...files];
  if (!list.length) return;
  for (const file of list) {
    const item = { id: nextId++, file, name: file.name || 'pasted-image.png', size: file.size, busy: true };
    items.push(item);
    try {
      Object.assign(item, await decode(file));
    } catch (err) {
      item.error = err.message;
      item.busy = false;
    }
  }
  render();
  await convertAll();
}

function removeItem(id) {
  const item = items.find((i) => i.id === id);
  if (!item) return;
  if (item.url) URL.revokeObjectURL(item.url);
  if (item.out?.url) URL.revokeObjectURL(item.out.url);
  items = items.filter((i) => i !== item);
  render();
}

// Names are worked out together so two "photo.png" inputs don't collide.
function outputNames() {
  const taken = new Set();
  return new Map(items.filter((i) => i.out).map((i) => [i.id, outputName(i.name, i.out.format.ext, taken)]));
}

function render() {
  el.panel.hidden = !items.length;
  const names = outputNames();
  el.results.innerHTML = items.map((item) => {
    const before = item.width ? `${item.width}×${item.height} ${escapeHTML(item.kind)} · ${formatBytes(item.size)}` : formatBytes(item.size);
    let after = '';
    let status = '';
    if (item.error) status = `<span class="img-error">${icon('alert')}${escapeHTML(item.error)}</span>`;
    else if (item.encodeError) status = `<span class="img-error">${icon('alert')}${escapeHTML(item.encodeError)}</span>`;
    else if (item.busy && !item.out) status = '<span class="hint">Converting…</span>';
    if (item.out && !item.error) {
      const o = item.out;
      const delta = sizeChange(item.size, o.blob.size);
      after = `<span class="img-arrow">→</span> ${o.width}×${o.height} ${o.format.label} · <strong>${formatBytes(o.blob.size)}</strong>
        <span class="badge ${o.blob.size <= item.size ? 'badge-ok' : 'badge-warn'}">${delta}</span>`;
    }
    const thumb = item.out?.url || item.url;
    return `<li class="img-item${item.busy ? ' is-busy' : ''}" data-id="${item.id}">
      <span class="img-thumb">${thumb ? `<img src="${thumb}" alt="">` : icon('image')}</span>
      <div class="img-info">
        <div class="img-name">${escapeHTML(names.get(item.id) || item.name)}</div>
        <div class="img-meta">${before} ${after}</div>
        ${status}
      </div>
      <div class="img-actions">
        ${item.out && !item.error ? `<button class="btn" type="button" data-download="${item.id}">${icon('download')}Download</button>` : ''}
        <button class="btn btn-ghost btn-icon" type="button" data-remove="${item.id}" aria-label="Remove" title="Remove">${icon('close')}</button>
      </div>
    </li>`;
  }).join('');

  const done = items.filter((i) => i.out && !i.error);
  const inBytes = done.reduce((n, i) => n + i.size, 0);
  const outBytes = done.reduce((n, i) => n + i.out.blob.size, 0);
  el.totals.textContent = done.length ? `${formatCount(done.length, 'image')} · ${formatBytes(inBytes)} → ${formatBytes(outBytes)} (${sizeChange(inBytes, outBytes)})` : '';
  el.downloadAll.disabled = !done.length || items.some((i) => i.busy);
  el.downloadAll.innerHTML = `${icon('download')}${done.length > 1 ? 'Download all (.zip)' : 'Download'}`;
}

async function downloadAll() {
  const names = outputNames();
  const done = items.filter((i) => i.out && !i.error);
  if (done.length === 1) return downloadBlob(done[0].out.blob, names.get(done[0].id));
  const entries = await Promise.all(done.map(async (i) => ({ name: names.get(i.id), data: new Uint8Array(await i.out.blob.arrayBuffer()) })));
  downloadBlob(new Blob([makeZip(entries)], { type: 'application/zip' }), `images-${format().ext}.zip`);
}

// ---------- wiring ----------

const changed = () => { syncOptions(); persist(); convertAll(); };
const changedSoon = debounce(changed, 200);
$$('input[name=format]').forEach((r) => r.addEventListener('change', changed));
el.quality.addEventListener('input', () => { el.qualityOut.value = el.quality.value; changedSoon(); });
[el.resize, el.bg].forEach((x) => x.addEventListener('change', changed));
[el.scale, el.maxWidth, el.maxHeight].forEach((x) => x.addEventListener('input', changedSoon));

$('#choose').addEventListener('click', () => el.file.click());
el.file.addEventListener('change', () => { addFiles(el.file.files); el.file.value = ''; });
$('#clear').addEventListener('click', () => { for (const i of [...items]) removeItem(i.id); generation++; });
el.downloadAll.addEventListener('click', downloadAll);
el.results.addEventListener('click', (e) => {
  const dl = e.target.closest('[data-download]');
  if (dl) {
    const item = items.find((i) => i.id === Number(dl.dataset.download));
    if (item?.out) downloadBlob(item.out.blob, outputNames().get(item.id));
    return;
  }
  const rm = e.target.closest('[data-remove]');
  if (rm) removeItem(Number(rm.dataset.remove));
});

// Drop anywhere on the page; paste an image from the clipboard.
let depth = 0;
const hasFiles = (e) => e.dataTransfer?.types.includes('Files');
document.addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; el.dropZone.classList.add('is-dragover'); } });
document.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; el.dropZone.classList.remove('is-dragover'); } });
document.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  if (!e.dataTransfer?.files.length) return;
  e.preventDefault();
  depth = 0;
  el.dropZone.classList.remove('is-dragover');
  addFiles(e.dataTransfer.files);
});
document.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;
  e.preventDefault();
  addFiles(files);
  toast(`Pasted ${formatCount(files.length, 'image')}`);
});

syncOptions();
