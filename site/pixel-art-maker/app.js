import { encodeBMP, linePoints, snapEnd, brushOffset, hexToRgb, rgbToHex, PALETTE_16, MAX_SIDE } from '/lib/bmp.js';
import { $, $$, storage, debounce, downloadBlob, formatBytes, toast } from '/assets/ui.js';

const el = {
  tools: $$('input[name=tool]'),
  size: $('#size'),
  zoom: $('#zoom'),
  grid: $('#grid'),
  undo: $('#undo'),
  redo: $('#redo'),
  current: $('#current'),
  swatches: $('#swatches'),
  custom: $('#custom'),
  stage: $('#stage'),
  frame: $('#frame'),
  canvas: $('#canvas'),
  preview: $('#preview'),
  gridOverlay: $('#grid-overlay'),
  status: $('#status'),
  width: $('#width'),
  height: $('#height'),
  background: $('#background'),
  filename: $('#filename'),
  filesize: $('#filesize'),
};

const ctx = el.canvas.getContext('2d', { willReadFrequently: true });
const pctx = el.preview.getContext('2d');
const ZOOMS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32];
el.zoom.innerHTML = '<option value="fit">Fit</option>' + ZOOMS.map((z) => `<option value="${z}">${z * 100}%</option>`).join('');
el.swatches.innerHTML = PALETTE_16.map((c) => `<button type="button" class="paint-swatch" role="radio" data-color="${c}" aria-label="${c}" title="${c}"></button>`).join('');
// Set through the CSSOM: the CSP blocks style="" attributes in markup.
$$('.paint-swatch').forEach((b) => b.style.setProperty('--swatch', b.dataset.color));

// ---------- state ----------

const DEFAULTS = { tool: 'pencil', size: 1, color: '#000000', zoom: 'fit', grid: true, width: 64, height: 64, background: '#ffffff' };
const s = { ...DEFAULTS, ...storage.get('paint', {}) };
let W = clampSide(s.width);
let H = clampSide(s.height);
let image = new ImageData(W, H);
let color = hexToRgb(s.color) || [0, 0, 0];
let background = hexToRgb(s.background) || [255, 255, 255];
let undoStack = [];
let redoStack = [];
let dirty = false;

function clampSide(n) { return Math.min(MAX_SIDE, Math.max(1, Math.round(Number(n)) || 1)); }
const tool = () => $('input[name=tool]:checked').value;
const brush = () => Number(el.size.value);

function persist() {
  storage.set('paint', {
    tool: tool(), size: brush(), color: rgbToHex(color), zoom: el.zoom.value, grid: el.grid.getAttribute('aria-pressed') === 'true',
    width: W, height: H, background: el.background.value,
  });
}

// ---------- pixels ----------

function fillImage(rgb) {
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = 255; }
}

function stamp(data, w, h, x, y, size, rgb) {
  const o = brushOffset(size);
  for (let dy = 0; dy < size; dy++) {
    const py = y + o + dy;
    if (py < 0 || py >= h) continue;
    for (let dx = 0; dx < size; dx++) {
      const px = x + o + dx;
      if (px < 0 || px >= w) continue;
      const i = (py * w + px) * 4;
      data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
    }
  }
}

function drawLine(data, w, h, x0, y0, x1, y1, size, rgb) {
  for (const [x, y] of linePoints(x0, y0, x1, y1)) stamp(data, w, h, x, y, size, rgb);
}

const render = () => ctx.putImageData(image, 0, 0);

// ---------- undo ----------

// Keep roughly 64 MB of history at most, so a 1024×1024 canvas still gets
// a useful number of steps without exhausting memory.
const maxUndo = () => Math.max(5, Math.min(100, Math.floor((64 * 1024 * 1024) / (W * H * 4))));

// The background travels with each snapshot: it's what the eraser paints,
// so undoing "New canvas" must bring the old one back too.
function snapshot() {
  return { w: W, h: H, data: new Uint8ClampedArray(image.data), background: [...background] };
}
function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > maxUndo()) undoStack.shift();
  redoStack = [];
  syncHistory();
}
function restore(snap) {
  if (snap.w !== W || snap.h !== H) setSize(snap.w, snap.h);
  image.data.set(snap.data);
  background = snap.background;
  el.background.value = rgbToHex(background);
  persist();
  render();
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restore(undoStack.pop());
  changed();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
  changed();
}
function syncHistory() {
  el.undo.disabled = !undoStack.length;
  el.redo.disabled = !redoStack.length;
}

// ---------- canvas size and zoom ----------

function setSize(w, h) {
  W = w;
  H = h;
  el.canvas.width = el.preview.width = W;
  el.canvas.height = el.preview.height = H;
  image = new ImageData(W, H);
  el.width.value = W;
  el.height.value = H;
  layout();
}

function zoomLevel() {
  if (el.zoom.value !== 'fit') return Number(el.zoom.value);
  const avail = el.stage.clientWidth - 32;
  const z = Math.floor(Math.min(avail / W, 560 / H));
  return Math.max(1, Math.min(32, z || 1));
}

function layout() {
  const z = zoomLevel();
  el.frame.style.width = `${W * z}px`;
  el.frame.style.height = `${H * z}px`;
  const showGrid = el.grid.getAttribute('aria-pressed') === 'true' && z >= 4;
  el.gridOverlay.hidden = !showGrid;
  el.gridOverlay.style.backgroundSize = `${z}px ${z}px`;
  const rowSize = Math.ceil((W * 3) / 4) * 4;
  el.filesize.textContent = `${W}×${H} · ${formatBytes(54 + rowSize * H)}`;
  el.status.textContent = `${W}×${H} px · ${z * 100}%`;
}

// ---------- drawing ----------

let stroke = null; // { tool, last: [x, y], start: [x, y], pointerId }

function pixelAt(e) {
  const r = el.canvas.getBoundingClientRect();
  return [Math.floor(((e.clientX - r.left) / r.width) * W), Math.floor(((e.clientY - r.top) / r.height) * H)];
}

function pickColor([x, y]) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  setColor([image.data[i], image.data[i + 1], image.data[i + 2]]);
  toast(`Picked ${rgbToHex(color)}`);
}

function lineEnd(e, p) {
  return e.shiftKey ? snapEnd(stroke.start[0], stroke.start[1], p[0], p[1]) : p;
}

function drawPreview(end) {
  pctx.clearRect(0, 0, W, H);
  const prev = pctx.createImageData(W, H);
  drawLine(prev.data, W, H, stroke.start[0], stroke.start[1], end[0], end[1], brush(), color);
  pctx.putImageData(prev, 0, 0);
}

el.canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const p = pixelAt(e);
  if (e.altKey) { pickColor(p); return; }
  e.preventDefault();
  el.canvas.setPointerCapture(e.pointerId);
  const t = tool();
  stroke = { tool: t, start: p, last: p, pointerId: e.pointerId };
  pushUndo();
  if (t === 'line') {
    drawPreview(p);
  } else {
    stamp(image.data, W, H, p[0], p[1], brush(), t === 'eraser' ? background : color);
    render();
  }
});

el.canvas.addEventListener('pointermove', (e) => {
  const p = pixelAt(e);
  const inside = p[0] >= 0 && p[1] >= 0 && p[0] < W && p[1] < H;
  el.status.textContent = `${inside ? `${p[0]}, ${p[1]} · ` : ''}${W}×${H} px · ${zoomLevel() * 100}%`;
  if (!stroke || e.pointerId !== stroke.pointerId) return;
  if (stroke.tool === 'line') { drawPreview(lineEnd(e, p)); return; }
  // Coalesced events keep fast strokes smooth where the browser supports them.
  const events = e.getCoalescedEvents?.() || [e];
  const rgb = stroke.tool === 'eraser' ? background : color;
  for (const ce of events.length ? events : [e]) {
    const q = pixelAt(ce);
    drawLine(image.data, W, H, stroke.last[0], stroke.last[1], q[0], q[1], brush(), rgb);
    stroke.last = q;
  }
  render();
});

function endStroke(e) {
  if (!stroke || e.pointerId !== stroke.pointerId) return;
  if (stroke.tool === 'line' && e.type === 'pointerup') {
    const end = lineEnd(e, pixelAt(e));
    drawLine(image.data, W, H, stroke.start[0], stroke.start[1], end[0], end[1], brush(), color);
    render();
  }
  if (stroke.tool === 'line' && e.type === 'pointercancel') undoStack.pop();
  pctx.clearRect(0, 0, W, H);
  stroke = null;
  changed();
}
el.canvas.addEventListener('pointerup', endStroke);
el.canvas.addEventListener('pointercancel', endStroke);
el.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- colours ----------

function setColor(rgb) {
  color = rgb;
  const hex = rgbToHex(rgb);
  el.current.style.setProperty('--swatch', hex);
  el.current.title = `Current colour ${hex}`;
  el.custom.value = hex;
  $$('.paint-swatch').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.color === hex)));
  persist();
}
el.swatches.addEventListener('click', (e) => {
  const b = e.target.closest('[data-color]');
  if (b) setColor(hexToRgb(b.dataset.color));
});
el.custom.addEventListener('input', () => setColor(hexToRgb(el.custom.value)));

// ---------- canvas and file ----------

function changed() {
  dirty = true;
  syncHistory();
  autosave();
}

// Small drawings survive a reload (as PNG in localStorage); big ones would
// exceed the storage quota.
const autosave = debounce(() => {
  if (W * H > 512 * 512) { storage.remove('paint-image'); return; }
  try { storage.set('paint-image', el.canvas.toDataURL('image/png')); } catch { /* quota */ }
}, 600);

function newCanvas() {
  const w = clampSide(el.width.value);
  const h = clampSide(el.height.value);
  pushUndo();
  background = hexToRgb(el.background.value) || background;
  setSize(w, h);
  fillImage(background);
  render();
  changed();
  persist();
}

async function loadImage(src, { fit = false } = {}) {
  const img = new Image();
  img.src = src;
  await img.decode();
  let w = img.naturalWidth || 64;
  let h = img.naturalHeight || 64;
  if (fit && (w > MAX_SIDE || h > MAX_SIDE)) {
    const f = MAX_SIDE / Math.max(w, h);
    w = Math.max(1, Math.round(w * f));
    h = Math.max(1, Math.round(h * f));
    toast(`Scaled to ${w}×${h} (largest side ${MAX_SIDE} px)`);
  }
  setSize(w, h);
  // Flatten transparency onto the background, as the BMP will.
  ctx.fillStyle = rgbToHex(background);
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, w, h);
  image = ctx.getImageData(0, 0, w, h);
}

$('#new').addEventListener('click', newCanvas);
$('#open').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const url = URL.createObjectURL(file);
  pushUndo();
  try {
    await loadImage(url, { fit: true });
    el.filename.value = file.name.replace(/\.[^.]+$/, '') || 'pixel-art';
    changed();
    persist();
  } catch {
    undoStack.pop();
    syncHistory();
    toast('That image couldn’t be opened.', 'error');
  } finally {
    URL.revokeObjectURL(url);
  }
});
// The picker is the colour for the next New canvas; the eraser keeps using
// the current drawing's background until then.
el.background.addEventListener('input', persist);

$('#download').addEventListener('click', () => {
  const bytes = encodeBMP(W, H, image.data, background);
  const name = (el.filename.value.trim() || 'pixel-art').replace(/[\\/:*?"<>|]/g, '_').replace(/\.bmp$/i, '');
  downloadBlob(new Blob([bytes], { type: 'image/bmp' }), `${name}.bmp`);
  dirty = false;
});

window.addEventListener('beforeunload', (e) => {
  // Small drawings are autosaved; only warn when a big one would be lost.
  if (dirty && W * H > 512 * 512) { e.preventDefault(); e.returnValue = ''; }
});

// ---------- toolbar ----------

el.tools.forEach((r) => r.addEventListener('change', persist));
el.size.addEventListener('change', persist);
el.zoom.addEventListener('change', () => { layout(); persist(); });
el.grid.addEventListener('click', () => {
  el.grid.setAttribute('aria-pressed', String(el.grid.getAttribute('aria-pressed') !== 'true'));
  layout();
  persist();
});
el.undo.addEventListener('click', undo);
el.redo.addEventListener('click', redo);
window.addEventListener('resize', debounce(layout, 100));

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea, [contenteditable]')) return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); (e.shiftKey ? redo : undo)(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod || e.altKey) return;
  const pickTool = { p: 'pencil', l: 'line', e: 'eraser' }[k];
  if (pickTool) { $(`input[name=tool][value=${pickTool}]`).click(); return; }
  if (k === 'g') { el.grid.click(); return; }
  if (k === '[' || k === ']') {
    const opts = [...el.size.options].map((o) => o.value);
    const i = opts.indexOf(el.size.value) + (k === ']' ? 1 : -1);
    if (i >= 0 && i < opts.length) { el.size.value = opts[i]; persist(); toast(`Brush ${opts[i]} px`); }
  }
});

// ---------- start ----------

$(`input[name=tool][value=${s.tool}]`)?.click();
el.size.value = String([1, 2, 3, 4, 6, 8].includes(Number(s.size)) ? s.size : 1);
el.zoom.value = ZOOMS.includes(Number(s.zoom)) ? String(s.zoom) : 'fit';
el.grid.setAttribute('aria-pressed', String(!!s.grid));
el.background.value = rgbToHex(background);
setColor(color);
setSize(W, H);
fillImage(background);
render();
const saved = storage.get('paint-image');
if (saved) {
  try { await loadImage(saved); render(); } catch { storage.remove('paint-image'); }
}
syncHistory();
