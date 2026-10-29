// Password and passphrase generation. Every random choice is a uniform pick
// from crypto.getRandomValues with rejection sampling, so there's no modulo
// bias; entropy figures are exact for the chosen settings.

export const LOWER = 'abcdefghijklmnopqrstuvwxyz';
export const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const DIGITS = '0123456789';
// Accepted by nearly every site and safe unquoted in most shells and configs.
export const DEFAULT_SYMBOLS = '!#$%&*+-=?@^_';
export const LOOKALIKES = '0Oo1lI|';

const defaultFill = (arr) => crypto.getRandomValues(arr);

// Uniform integer in [0, n), n ≤ 2^32. Values from the top partial range
// are discarded rather than wrapped, which is what removes the bias.
export function randomInt(n, fill = defaultFill) {
  if (!Number.isInteger(n) || n < 1 || n > 2 ** 32) throw new RangeError(`randomInt: bad range ${n}`);
  const limit = 2 ** 32 - (2 ** 32 % n);
  const buf = new Uint32Array(1);
  for (;;) {
    fill(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

// The character sets in use, each with duplicates (and characters already in
// an earlier set) removed, so the union has no repeats.
export function buildSets({ lower = true, upper = true, digits = true, symbols = true, symbolChars = DEFAULT_SYMBOLS, avoidLookalikes = false } = {}) {
  const seen = new Set();
  const sets = [];
  const add = (id, chars) => {
    const unique = [...chars].filter((c) => c.trim() && !(avoidLookalikes && LOOKALIKES.includes(c)) && !seen.has(c) && seen.add(c));
    if (unique.length) sets.push({ id, chars: unique });
  };
  if (lower) add('lower', LOWER);
  if (upper) add('upper', UPPER);
  if (digits) add('digits', DIGITS);
  if (symbols) add('symbols', symbolChars);
  return sets;
}

export function generatePassword({ length, sets, requireEach = true }, fill = defaultFill) {
  if (!sets.length) throw new Error('Choose at least one kind of character.');
  if (requireEach && length < sets.length) throw new Error(`A ${length}-character password can’t include all ${sets.length} selected kinds of character.`);
  const pool = sets.flatMap((s) => s.chars);
  // Regenerating until every set appears keeps the result uniform over all
  // passwords that satisfy the rule (unlike forcing one character per set).
  for (let attempt = 0; attempt < 10000; attempt++) {
    const chars = Array.from({ length }, () => pool[randomInt(pool.length, fill)]);
    if (!requireEach || sets.every((s) => chars.some((c) => s.chars.includes(c)))) return chars.join('');
  }
  throw new Error('Couldn’t satisfy the character rules; try a longer password.');
}

// log2 of a positive BigInt, accurate to double precision.
export function log2Big(n) {
  const len = n.toString(2).length;
  if (len <= 53) return Math.log2(Number(n));
  return Math.log2(Number(n >> BigInt(len - 53))) + (len - 53);
}

// Exact count of possible passwords: N^L, or with "use every kind" the
// inclusion–exclusion count of strings that contain each set at least once.
export function passwordEntropy({ length, sets, requireEach = true }) {
  const sizes = sets.map((s) => s.chars.length);
  const total = sizes.reduce((a, b) => a + b, 0);
  if (!total || !length) return 0;
  if (!requireEach || sets.length === 1) return log2Big(BigInt(total) ** BigInt(length));
  let count = 0n;
  for (let mask = 0; mask < 1 << sizes.length; mask++) {
    let excluded = 0;
    let bits = 0;
    sizes.forEach((sz, i) => { if (mask & (1 << i)) { excluded += sz; bits++; } });
    const term = BigInt(total - excluded) ** BigInt(length);
    count += bits % 2 ? -term : term;
  }
  return count > 0n ? log2Big(count) : 0;
}

export const SEPARATORS = [
  { id: '-', label: 'Hyphen  ( - )' },
  { id: ' ', label: 'Space' },
  { id: '.', label: 'Period  ( . )' },
  { id: '_', label: 'Underscore  ( _ )' },
  { id: ',', label: 'Comma  ( , )' },
];

const capitalize = (w) => w[0].toUpperCase() + w.slice(1);

export function generatePassphrase({ words, wordlist, separator = '-', capitalizeWords = false, addNumber = false }, fill = defaultFill) {
  if (words < 1) throw new Error('Use at least one word.');
  const picked = Array.from({ length: words }, () => wordlist[randomInt(wordlist.length, fill)]);
  const out = capitalizeWords ? picked.map(capitalize) : picked;
  if (addNumber) {
    const i = randomInt(words, fill);
    out[i] += String(randomInt(10, fill));
  }
  return out.join(separator);
}

// Capitalising is deterministic, so it adds nothing; the digit adds its value
// and which word it's on.
export function passphraseEntropy({ words, wordlistSize, addNumber = false }) {
  return words * Math.log2(wordlistSize) + (addNumber ? Math.log2(10 * words) : 0);
}

export function strength(bits) {
  if (bits < 45) return { id: 'weak', label: 'Weak' };
  if (bits < 64) return { id: 'fair', label: 'Fair' };
  if (bits < 80) return { id: 'strong', label: 'Strong' };
  return { id: 'very-strong', label: 'Very strong' };
}

// Average time to guess (half the space) at `rate` guesses per second.
export function crackTime(bits, rate = 1e10) {
  const seconds = 2 ** (bits - 1) / rate;
  const units = [['second', 60], ['minute', 60], ['hour', 24], ['day', 365.25], ['year', 1000]];
  let v = seconds;
  for (const [name, next] of units) {
    if (v < next) return v < 1 && name === 'second' ? 'less than a second' : plural(Math.round(v), name);
    v /= next;
  }
  const years = seconds / 31557600;
  if (years < 1e6) return `${Math.round(years / 1000).toLocaleString('en-US')} thousand years`;
  if (years < 1e9) return `${Math.round(years / 1e6).toLocaleString('en-US')} million years`;
  if (years < 1.38e10) return `${Math.round(years / 1e9).toLocaleString('en-US')} billion years`;
  return 'longer than the age of the universe';
}
const plural = (n, w) => `${n.toLocaleString('en-US')} ${n === 1 ? w : w + 's'}`;
