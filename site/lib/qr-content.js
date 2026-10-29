// Builds QR payload strings for common content types. Each builder takes a
// plain object of form values and returns { text } or throws an Error with a
// message suitable for showing next to the form.

const trim = (v) => String(v ?? '').trim();

// Wi-Fi / MeCard escaping: backslash-escape \ ; , : "
const escMe = (s) => String(s).replace(/([\\;,:"])/g, '\\$1');
// vCard / iCalendar text escaping (RFC 6350 §3.4, RFC 5545 §3.3.11)
const escV = (s) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

function required(values, ...keys) {
  for (const k of keys) {
    if (!trim(values[k])) throw new Error(`${LABELS[k] || k} is required.`);
  }
}
const LABELS = { url: 'URL', text: 'Text', ssid: 'Network name', phone: 'Phone number', to: 'Email address', lat: 'Latitude', lng: 'Longitude', title: 'Title', start: 'Start', address: 'Address' };

// ---------- builders ----------

export function url({ url: u }) {
  let s = trim(u);
  if (!s) throw new Error('URL is required.');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  try {
    new URL(s);
  } catch {
    throw new Error('That isn’t a valid URL.');
  }
  return { text: s };
}

export function text({ text: t }) {
  if (!String(t ?? '').length) throw new Error('Text is required.');
  return { text: String(t) };
}

// Format understood by Android and iOS cameras (ZXing "WIFI:" scheme).
export function wifi({ ssid, password, auth = 'WPA', hidden = false }) {
  required({ ssid }, 'ssid');
  const t = auth === 'nopass' ? 'nopass' : auth;
  if (t !== 'nopass' && !String(password ?? '').length) throw new Error('Password is required for a secured network (or choose “None”).');
  if (t === 'WPA' && String(password).length < 8) throw new Error('WPA passwords are at least 8 characters.');
  let s = `WIFI:T:${t};S:${escMe(ssid)};`;
  if (t !== 'nopass') s += `P:${escMe(password)};`;
  if (hidden) s += 'H:true;';
  return { text: s + ';' };
}

export function vcard(v) {
  const first = trim(v.first), last = trim(v.last);
  if (!first && !last && !trim(v.org)) throw new Error('Enter a name or an organization.');
  const fn = [first, last].filter(Boolean).join(' ') || trim(v.org);
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${escV(last)};${escV(first)};;;`, `FN:${escV(fn)}`];
  if (trim(v.org)) lines.push(`ORG:${escV(trim(v.org))}`);
  if (trim(v.jobTitle)) lines.push(`TITLE:${escV(trim(v.jobTitle))}`);
  if (trim(v.phone)) lines.push(`TEL;TYPE=CELL:${trim(v.phone)}`);
  if (trim(v.workPhone)) lines.push(`TEL;TYPE=WORK:${trim(v.workPhone)}`);
  if (trim(v.email)) lines.push(`EMAIL:${trim(v.email)}`);
  if (trim(v.website)) lines.push(`URL:${trim(v.website)}`);
  const adr = [v.street, v.city, v.region, v.postcode, v.country].map(trim);
  if (adr.some(Boolean)) lines.push(`ADR;TYPE=WORK:;;${adr.map(escV).join(';')}`);
  if (trim(v.note)) lines.push(`NOTE:${escV(trim(v.note))}`);
  lines.push('END:VCARD');
  return { text: lines.join('\r\n') };
}

// MeCard: more compact than vCard (smaller code), fewer fields.
export function mecard(v) {
  const first = trim(v.first), last = trim(v.last);
  if (!first && !last) throw new Error('Enter a name.');
  let s = `MECARD:N:${escMe(last)},${escMe(first)};`;
  if (trim(v.phone)) s += `TEL:${escMe(trim(v.phone))};`;
  if (trim(v.email)) s += `EMAIL:${escMe(trim(v.email))};`;
  if (trim(v.website)) s += `URL:${escMe(trim(v.website))};`;
  const adr = [v.street, v.city, v.region, v.postcode, v.country].map(trim).filter(Boolean).join(', ');
  if (adr) s += `ADR:${escMe(adr)};`;
  if (trim(v.org)) s += `NOTE:${escMe([trim(v.org), trim(v.jobTitle)].filter(Boolean).join(', '))};`;
  return { text: s + ';' };
}

export function email({ to, subject, body }) {
  required({ to }, 'to');
  if (!/^[^\s@]+@[^\s@]+$/.test(trim(to))) throw new Error('That doesn’t look like an email address.');
  const q = [];
  if (trim(subject)) q.push('subject=' + encodeURIComponent(trim(subject)));
  if (String(body ?? '').trim()) q.push('body=' + encodeURIComponent(String(body)));
  return { text: `mailto:${trim(to)}${q.length ? '?' + q.join('&') : ''}` };
}

const cleanPhone = (p) => trim(p).replace(/[\s().-]/g, '');

export function sms({ phone, message }) {
  required({ phone }, 'phone');
  const num = cleanPhone(phone);
  if (!/^\+?[0-9*#]{2,}$/.test(num)) throw new Error('Phone number can contain digits and a leading +.');
  return { text: `SMSTO:${num}:${String(message ?? '')}` };
}

export function phone({ phone: p }) {
  required({ phone: p }, 'phone');
  const num = cleanPhone(p);
  if (!/^\+?[0-9*#]{2,}$/.test(num)) throw new Error('Phone number can contain digits and a leading +.');
  return { text: `tel:${num}` };
}

export function geo({ lat, lng, label }) {
  required({ lat, lng }, 'lat', 'lng');
  const la = Number(lat), lo = Number(lng);
  if (!Number.isFinite(la) || la < -90 || la > 90) throw new Error('Latitude must be between -90 and 90.');
  if (!Number.isFinite(lo) || lo < -180 || lo > 180) throw new Error('Longitude must be between -180 and 180.');
  const q = trim(label) ? `?q=${la},${lo}(${encodeURIComponent(trim(label))})` : '';
  return { text: `geo:${la},${lo}${q}` };
}

// datetime-local value ("2026-10-29T14:30") → UTC "20261029T183000Z"
function icsDateTime(local) {
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) throw new Error('Enter a valid date and time.');
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
const icsDate = (local) => String(local).slice(0, 10).replace(/-/g, '');

export function event({ title, location, description, start, end, allDay = false }) {
  required({ title, start }, 'title', 'start');
  const lines = ['BEGIN:VEVENT', `SUMMARY:${escV(trim(title))}`];
  if (allDay) {
    const s = icsDate(start);
    const endDay = new Date(String(end || start).slice(0, 10) + 'T00:00:00Z');
    endDay.setUTCDate(endDay.getUTCDate() + 1); // DTEND is exclusive for all-day events
    lines.push(`DTSTART;VALUE=DATE:${s}`, `DTEND;VALUE=DATE:${endDay.toISOString().slice(0, 10).replace(/-/g, '')}`);
  } else {
    const s = icsDateTime(start);
    lines.push(`DTSTART:${s}`);
    if (trim(end)) {
      const e = icsDateTime(end);
      if (e < s) throw new Error('End must be after start.');
      lines.push(`DTEND:${e}`);
    }
  }
  if (trim(location)) lines.push(`LOCATION:${escV(trim(location))}`);
  if (trim(description)) lines.push(`DESCRIPTION:${escV(String(description).trim())}`);
  lines.push('END:VEVENT');
  return { text: lines.join('\r\n') };
}

const CRYPTO = {
  bitcoin: { re: /^(bc1[02-9ac-hj-np-z]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34}|tb1[02-9ac-hj-np-z]{11,87}|[mn2][1-9A-HJ-NP-Za-km-z]{25,34})$/i, amount: true },
  litecoin: { re: /^(ltc1[02-9ac-hj-np-z]{11,87}|[LM3][1-9A-HJ-NP-Za-km-z]{25,34})$/i, amount: true },
  ethereum: { re: /^0x[0-9a-fA-F]{40}$/, amount: false },
};

// BIP 21 style URIs (bitcoin:, litecoin:) and EIP-681 ethereum: addresses.
export function crypto({ coin = 'bitcoin', address: addr, amount, label, message }) {
  required({ address: addr }, 'address');
  const spec = CRYPTO[coin];
  if (!spec) throw new Error('Unsupported coin.');
  const a = trim(addr);
  if (!spec.re.test(a)) throw new Error(`That doesn’t look like a ${coin[0].toUpperCase() + coin.slice(1)} address.`);
  const q = [];
  if (spec.amount && trim(amount)) {
    if (!/^\d+(\.\d{1,8})?$/.test(trim(amount))) throw new Error('Amount must be a number with up to 8 decimal places.');
    q.push(`amount=${trim(amount)}`);
  }
  if (spec.amount && trim(label)) q.push(`label=${encodeURIComponent(trim(label))}`);
  if (spec.amount && trim(message)) q.push(`message=${encodeURIComponent(trim(message))}`);
  return { text: `${coin}:${a}${q.length ? '?' + q.join('&') : ''}` };
}

export const BUILDERS = { url, text, wifi, vcard, mecard, email, sms, phone, geo, event, crypto };
