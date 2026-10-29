// Timestamp parsing and formatting. Internally everything is an exact BigInt
// count of nanoseconds since the Unix epoch, so µs/ns inputs keep full precision.

export const UNITS = [
  { id: 'auto', label: 'Auto-detect' },
  { id: 's', label: 'Seconds' },
  { id: 'ms', label: 'Milliseconds' },
  { id: 'us', label: 'Microseconds' },
  { id: 'ns', label: 'Nanoseconds' },
];
const SCALE = { s: 9, ms: 6, us: 3, ns: 0 };
const UNIT_NAMES = { s: 'seconds', ms: 'milliseconds', us: 'microseconds', ns: 'nanoseconds' };
const MAX_MS = 8.64e15; // ECMAScript Date range

// Digit-count heuristic: 10 digits ≈ seconds today, 13 ms, 16 µs, 19 ns.
function detectUnit(intDigits) {
  if (intDigits <= 11) return 's';
  if (intDigits <= 14) return 'ms';
  if (intDigits <= 17) return 'us';
  return 'ns';
}

const floorDiv = (a, b) => (a >= 0n ? a / b : -((-a + b - 1n) / b));

export function parseTimestamp(input, unit = 'auto', now = Date.now()) {
  const s = input.trim().replace(/[_,\s](?=\d)/g, '');
  if (!s) return null;
  if (/^now$/i.test(s)) return { ns: BigInt(now) * 1_000_000n, source: 'now' };

  const num = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (num) {
    const [, sign, int, frac = ''] = num;
    const u = unit === 'auto' ? detectUnit(int.replace(/^0+/, '').length) : unit;
    const digits = SCALE[u];
    let ns = BigInt(int) * 10n ** BigInt(digits) + BigInt((frac + '0'.repeat(digits)).slice(0, digits) || '0');
    if (sign === '-') ns = -ns;
    const ms = Number(floorDiv(ns, 1_000_000n));
    if (Math.abs(ms) > MAX_MS) throw new Error('Out of range: dates must fall within ±275,000 years of 1970.');
    return { ns, source: 'number', unit: u, unitName: UNIT_NAMES[u], detected: unit === 'auto' };
  }

  const ms = Date.parse(s);
  if (Number.isNaN(ms)) {
    throw new Error('Unrecognised date. Use a Unix timestamp, ISO 8601 (2026-10-29T14:30:00Z) or RFC 2822.');
  }
  // ISO date-time strings without an offset are parsed as local time; date-only as UTC.
  const zoneless = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s);
  const isoFrac = /\.(\d{4,9})(?:Z|[+-]\d{2}:?\d{2})?$/i.exec(s);
  let ns = BigInt(ms) * 1_000_000n;
  if (isoFrac) ns += BigInt(isoFrac[1].padEnd(9, '0').slice(3, 9)) * (ms < 0 ? -1n : 1n); // keep sub-ms digits
  return { ns, source: 'date', zoneless };
}

function decimal(ns, scaleDigits) {
  const neg = ns < 0n;
  const abs = neg ? -ns : ns;
  const base = 10n ** BigInt(scaleDigits);
  const int = (abs / base).toString();
  const frac = scaleDigits ? (abs % base).toString().padStart(scaleDigits, '0').replace(/0+$/, '') : '';
  return (neg ? '-' : '') + int + (frac ? '.' + frac : '');
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'longOffset',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const off = get('timeZoneName').replace('GMT', '') || '+00:00';
  return {
    year: Number(get('year')), month: Number(get('month')), day: Number(get('day')),
    time: `${get('hour')}:${get('minute')}:${get('second')}`,
    offset: off === '+00:00' || off === '' ? 'Z' : off,
  };
}

function isoWeek(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dow);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  return { week: Math.ceil(((date - yearStart) / 86400000 + 1) / 7), year: date.getUTCFullYear() };
}

export function relative(ms, now = Date.now()) {
  const diff = (ms - now) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  // Switch units before the rounded value reaches the next unit, so 3,599 s
  // reads "in 1 hour" rather than "in 60 minutes".
  const steps = [[45, 'second', 1], [2700, 'minute', 60], [79200, 'hour', 3600], [561600, 'day', 86400],
    [2419200, 'week', 604800], [28927800, 'month', 2629800], [Infinity, 'year', 31557600]];
  for (const [limit, unit, div] of steps) {
    if (abs < limit) return rtf.format(Math.round(diff / div), unit);
  }
  return '';
}

// All representations of one instant, ready for display.
export function describe(ns, timeZone, now = Date.now()) {
  const ms = Number(floorDiv(ns, 1_000_000n));
  const date = new Date(ms);
  const subMs = Number(ns - BigInt(ms) * 1_000_000n);
  const z = zonedParts(date, timeZone);
  const msStr = String(date.getUTCMilliseconds()).padStart(3, '0');
  const frac = subMs ? `${msStr}${String(subMs).padStart(6, '0')}`.replace(/0+$/, '') : msStr;
  const ymd = `${String(z.year).padStart(4, '0')}-${String(z.month).padStart(2, '0')}-${String(z.day).padStart(2, '0')}`;
  const wk = isoWeek(z.year, z.month, z.day);
  const dayOfYear = Math.round((Date.UTC(z.year, z.month - 1, z.day) - Date.UTC(z.year, 0, 1)) / 86400000) + 1;
  return {
    seconds: decimal(ns, 9),
    milliseconds: decimal(ns, 6),
    microseconds: decimal(ns, 3),
    nanoseconds: ns.toString(),
    isoUtc: date.toISOString().replace(/\.\d{3}Z$/, `.${frac}Z`),
    isoZoned: `${ymd}T${z.time}.${frac}${z.offset}`,
    rfc2822: date.toUTCString(),
    human: new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'full', timeStyle: 'long' }).format(date),
    relative: relative(ms, now),
    weekday: new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(date),
    isoWeek: `${wk.year}-W${String(wk.week).padStart(2, '0')}`,
    dayOfYear,
  };
}
