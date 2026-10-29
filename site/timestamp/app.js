import { UNITS, parseTimestamp, describe, relative } from '/lib/timestamp.js';
import { $, storage, debounce, copyText, kvRow, alertHTML } from '/assets/ui.js';

const el = {
  input: $('#input'),
  unit: $('#unit'),
  tz: $('#tz'),
  picker: $('#picker'),
  rows: $('#rows'),
  messages: $('#messages'),
  nowS: $('#now-s'),
  nowMs: $('#now-ms'),
};

const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const zones = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [localZone];
  }
})();
const zoneList = ['UTC', ...zones.filter((z) => z !== 'UTC' && z !== localZone)];

el.unit.innerHTML = UNITS.map((u) => `<option value="${u.id}">${u.label}</option>`).join('');
el.tz.innerHTML = `<option value="${localZone}">${localZone} (local)</option>` +
  zoneList.map((z) => `<option value="${z}">${z.replace(/_/g, ' ')}</option>`).join('');

const saved = storage.get('timestamp', {});
el.tz.value = zoneList.includes(saved.tz) || saved.tz === localZone ? saved.tz : localZone;
el.unit.value = saved.unit || 'auto';

let current = null; // last parsed BigInt ns, for the live "relative" row

function render() {
  el.messages.innerHTML = '';
  const raw = el.input.value;
  let parsed;
  try {
    parsed = parseTimestamp(raw, el.unit.value);
  } catch (err) {
    current = null;
    el.rows.innerHTML = '';
    el.messages.innerHTML = alertHTML('error', err.message);
    return;
  }
  if (!parsed) {
    current = null;
    el.rows.innerHTML = '';
    return;
  }
  current = parsed.ns;
  const tz = el.tz.value;
  const d = describe(parsed.ns, tz);

  const notes = [];
  if (parsed.detected) notes.push(`Read as <strong>${parsed.unitName}</strong> based on its length. Choose a unit to override.`);
  if (parsed.zoneless) notes.push('No time zone in the input, so it was read as your browser’s local time. Add Z or an offset like +02:00 to be explicit.');
  el.messages.innerHTML = notes.map((n) => alertHTML('info', n, { html: true })).join('');

  el.rows.innerHTML = [
    kvRow('Unix seconds', d.seconds),
    kvRow('Milliseconds', d.milliseconds),
    kvRow('Microseconds', d.microseconds),
    kvRow('Nanoseconds', d.nanoseconds),
    kvRow('ISO 8601', d.isoUtc, { sub: 'UTC' }),
    kvRow('ISO 8601', d.isoZoned, { sub: tz === 'UTC' ? 'UTC' : 'with offset' }),
    kvRow('RFC 2822 / HTTP', d.rfc2822),
    kvRow('Human', d.human, { plain: true }),
    kvRow('Relative', d.relative, { plain: true, cls: 'kv-relative' }),
    kvRow('Week & day', `${d.weekday} · ${d.isoWeek} · day ${d.dayOfYear}`, { plain: true }),
  ].join('');
}

const persist = () => storage.set('timestamp', { tz: el.tz.value, unit: el.unit.value });

function tick() {
  const now = Date.now();
  el.nowS.textContent = Math.floor(now / 1000);
  el.nowMs.textContent = now;
  if (current !== null && now % 5000 < 1000) {
    const row = $('.kv-relative');
    if (row) row.outerHTML = kvRow('Relative', relative(Number(current / 1_000_000n), now), { plain: true, cls: 'kv-relative' });
  }
}

el.input.addEventListener('input', debounce(render, 80));
el.unit.addEventListener('change', () => { persist(); render(); });
el.tz.addEventListener('change', () => { persist(); render(); });
el.picker.addEventListener('change', () => {
  if (!el.picker.value) return;
  // datetime-local is wall-clock time in the browser's zone.
  el.input.value = new Date(el.picker.value).toISOString();
  el.unit.value = 'auto';
  render();
});
$('#use-now').addEventListener('click', () => {
  el.input.value = String(Date.now());
  el.unit.value = 'auto';
  render();
});
$('#copy-now-s').addEventListener('click', (e) => copyText(String(Math.floor(Date.now() / 1000)), e.currentTarget));
$('#copy-now-ms').addEventListener('click', (e) => copyText(String(Date.now()), e.currentTarget));

const fromHash = decodeURIComponent(location.hash.slice(1));
el.input.value = fromHash || String(Math.floor(Date.now() / 1000));
tick();
setInterval(tick, 1000);
render();
