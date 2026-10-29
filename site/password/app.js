import {
  DEFAULT_SYMBOLS, SEPARATORS, buildSets, generatePassword, passwordEntropy, generatePassphrase, passphraseEntropy,
  strength, crackTime,
} from '/lib/password.js';
import WORDS from '/vendor/eff-wordlist/wordlist.js';
import { $, $$, storage, copyText, alertHTML, escapeHTML } from '/assets/ui.js';
import { icon } from '/assets/icons.js';

const el = {
  modes: $$('input[name=mode]'),
  count: $('#count'),
  passwordOpts: $('#password-opts'),
  passphraseOpts: $('#passphrase-opts'),
  length: $('#length'),
  lengthOut: $('#length-out'),
  lower: $('#opt-lower'),
  upper: $('#opt-upper'),
  digits: $('#opt-digits'),
  symbols: $('#opt-symbols'),
  symbolChars: $('#symbol-chars'),
  symbolsField: $('#symbols-field'),
  lookalikes: $('#opt-lookalikes'),
  each: $('#opt-each'),
  words: $('#words'),
  wordsOut: $('#words-out'),
  separator: $('#separator'),
  capitalize: $('#opt-capitalize'),
  number: $('#opt-number'),
  messages: $('#messages'),
  strength: $('#strength'),
  meter: $('#meter-fill'),
  label: $('#strength-label'),
  bits: $('#strength-bits'),
  time: $('#strength-time'),
  results: $('#results'),
  copyAll: $('#copy-all'),
};

el.separator.innerHTML = SEPARATORS.map((s) => `<option value="${escapeHTML(s.id)}">${escapeHTML(s.label)}</option>`).join('');

// Only settings are stored; generated passwords never are.
const DEFAULTS = {
  mode: 'password', count: '5', length: 20, lower: true, upper: true, digits: true, symbols: true,
  symbolChars: DEFAULT_SYMBOLS, lookalikes: false, each: true, words: 6, separator: '-', capitalize: false, number: false,
};
const s = { ...DEFAULTS, ...storage.get('password', {}) };
let mode = s.mode === 'passphrase' ? 'passphrase' : 'password';
el.modes.forEach((r) => { r.checked = r.value === mode; });
el.count.value = ['1', '5', '10', '20'].includes(String(s.count)) ? String(s.count) : DEFAULTS.count;
el.length.value = s.length;
el.lower.checked = s.lower;
el.upper.checked = s.upper;
el.digits.checked = s.digits;
el.symbols.checked = s.symbols;
el.symbolChars.value = s.symbolChars;
el.lookalikes.checked = s.lookalikes;
el.each.checked = s.each;
el.words.value = s.words;
el.separator.value = SEPARATORS.some((x) => x.id === s.separator) ? s.separator : DEFAULTS.separator;
el.capitalize.checked = s.capitalize;
el.number.checked = s.number;

function persist() {
  storage.set('password', {
    mode, count: el.count.value, length: Number(el.length.value), lower: el.lower.checked, upper: el.upper.checked,
    digits: el.digits.checked, symbols: el.symbols.checked, symbolChars: el.symbolChars.value, lookalikes: el.lookalikes.checked,
    each: el.each.checked, words: Number(el.words.value), separator: el.separator.value, capitalize: el.capitalize.checked,
    number: el.number.checked,
  });
}

// Digits and symbols get their own colour so similar characters are easier
// to read back; separators are dimmed.
function colorize(text, separator) {
  return [...text].map((c) => {
    const e = escapeHTML(c);
    if (separator !== undefined && c === separator) return `<span class="pw-sep">${c === ' ' ? '·' : e}</span>`;
    if (/[0-9]/.test(c)) return `<span class="pw-d">${e}</span>`;
    if (/[A-Za-z]/.test(c) || separator !== undefined) return e;
    return `<span class="pw-s">${e}</span>`;
  }).join('');
}

let current = [];

function generate() {
  const n = Number(el.count.value);
  const notes = [];
  let bits = 0;
  let make;
  let sep;
  el.symbolsField.hidden = !el.symbols.checked;
  if (mode === 'password') {
    const opts = {
      length: Number(el.length.value),
      sets: buildSets({
        lower: el.lower.checked, upper: el.upper.checked, digits: el.digits.checked, symbols: el.symbols.checked,
        symbolChars: el.symbolChars.value, avoidLookalikes: el.lookalikes.checked,
      }),
      requireEach: el.each.checked,
    };
    el.lengthOut.value = opts.length;
    if (el.symbols.checked && !opts.sets.some((x) => x.id === 'symbols')) notes.push(alertHTML('info', 'No symbol characters entered, so symbols are off.'));
    bits = passwordEntropy(opts);
    make = () => generatePassword(opts);
  } else {
    const opts = { words: Number(el.words.value), wordlist: WORDS, separator: el.separator.value, capitalizeWords: el.capitalize.checked, addNumber: el.number.checked };
    el.wordsOut.value = opts.words;
    sep = opts.separator;
    bits = passphraseEntropy({ words: opts.words, wordlistSize: WORDS.length, addNumber: opts.addNumber });
    make = () => generatePassphrase(opts);
  }

  try {
    current = Array.from({ length: n }, make);
  } catch (err) {
    current = [];
    el.messages.innerHTML = notes.join('') + alertHTML('error', err.message);
    el.strength.hidden = true;
    el.results.innerHTML = '';
    el.copyAll.disabled = true;
    return;
  }

  const st = strength(bits);
  if (bits < 64) notes.push(alertHTML('warn', `${Math.floor(bits)} bits is only enough behind a login that limits attempts. Use at least 64 bits for accounts, and 80 for vaults, disks and backups.`));
  el.messages.innerHTML = notes.join('');
  el.strength.hidden = false;
  el.strength.dataset.level = st.id;
  el.meter.style.width = `${Math.max(4, Math.min(100, (bits / 128) * 100))}%`;
  el.label.textContent = st.label;
  el.bits.textContent = `${bits.toFixed(1)} bits`;
  const t = crackTime(bits);
  el.time.textContent = `${/^(less|longer)/.test(t) ? t[0].toUpperCase() + t.slice(1) : 'About ' + t} to crack at 10 billion guesses a second`;
  el.results.innerHTML = current.map((p, i) => `<li class="pw-item">
    <code class="pw-text">${colorize(p, sep)}</code>
    <button class="btn btn-ghost btn-icon" type="button" data-index="${i}" aria-label="Copy" title="Copy">${icon('copy')}</button>
  </li>`).join('');
  el.copyAll.disabled = false;
  el.copyAll.hidden = n === 1;
}

function syncMode() {
  el.passwordOpts.hidden = mode !== 'password';
  el.passphraseOpts.hidden = mode !== 'passphrase';
  el.results.setAttribute('aria-label', mode === 'password' ? 'Generated passwords' : 'Generated passphrases');
}

const changed = () => { persist(); generate(); };

el.modes.forEach((r) => r.addEventListener('change', () => { mode = r.value; syncMode(); changed(); }));
[el.count, el.lower, el.upper, el.digits, el.symbols, el.lookalikes, el.each, el.separator, el.capitalize, el.number]
  .forEach((x) => x.addEventListener('change', changed));
[el.length, el.words, el.symbolChars].forEach((x) => x.addEventListener('input', changed));
$('#generate').addEventListener('click', generate);
el.copyAll.addEventListener('click', () => copyText(current.join('\n'), el.copyAll));
// Copied from memory rather than a data- attribute, so the passwords aren't
// duplicated into the DOM.
el.results.addEventListener('click', (e) => {
  const b = e.target.closest('[data-index]');
  if (b) copyText(current[Number(b.dataset.index)], b);
});

syncMode();
generate();
