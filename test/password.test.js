import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  randomInt, buildSets, generatePassword, passwordEntropy, generatePassphrase, passphraseEntropy, log2Big,
  strength, crackTime, LOOKALIKES, DEFAULT_SYMBOLS,
} from '../site/lib/password.js';
import WORDS from '../site/vendor/eff-wordlist/wordlist.js';

// Deterministic "random" source that replays the given values.
const replay = (values) => { let i = 0; return (arr) => { arr[0] = values[i++ % values.length]; return arr; }; };

test('randomInt rejects the biased top range instead of wrapping', () => {
  // n = 3: limit = 2^32 - (2^32 % 3) = 4294967295, so 4294967295 is rejected.
  assert.equal(randomInt(3, replay([4294967295, 7])), 1);
  assert.equal(randomInt(1, replay([123])), 0);
  assert.throws(() => randomInt(0), RangeError);
});

test('randomInt is roughly uniform', () => {
  const counts = new Array(7).fill(0);
  const n = 70000;
  for (let i = 0; i < n; i++) counts[randomInt(7)]++;
  for (const c of counts) assert.ok(Math.abs(c - n / 7) < n / 7 * 0.05, `bucket count ${c} far from ${n / 7}`);
});

test('character sets: dedupe, lookalikes, empty sets dropped', () => {
  const all = buildSets();
  assert.deepEqual(all.map((s) => s.id), ['lower', 'upper', 'digits', 'symbols']);
  assert.equal(all.find((s) => s.id === 'symbols').chars.join(''), DEFAULT_SYMBOLS);
  const noLook = buildSets({ avoidLookalikes: true }).flatMap((s) => s.chars);
  for (const c of LOOKALIKES) assert.ok(!noLook.includes(c), `${c} should be excluded`);
  const custom = buildSets({ lower: false, upper: false, digits: true, symbolChars: '1!! ' });
  assert.deepEqual(custom.map((s) => s.chars.join('')), ['0123456789', '!']);
  assert.deepEqual(buildSets({ lower: false, upper: false, digits: false, symbols: true, symbolChars: '' }), []);
});

test('passwords use only the pool and include every set when required', () => {
  const sets = buildSets();
  const pool = new Set(sets.flatMap((s) => s.chars));
  for (let i = 0; i < 300; i++) {
    const pw = generatePassword({ length: 8, sets, requireEach: true });
    assert.equal(pw.length, 8);
    assert.ok([...pw].every((c) => pool.has(c)));
    for (const s of sets) assert.ok([...pw].some((c) => s.chars.includes(c)), `${pw} lacks ${s.id}`);
  }
  assert.throws(() => generatePassword({ length: 3, sets, requireEach: true }), /can’t include all 4/);
  assert.throws(() => generatePassword({ length: 10, sets: [] }), /at least one kind/);
});

test('password entropy is exact', () => {
  const digits = buildSets({ lower: false, upper: false, symbols: false });
  assert.equal(passwordEntropy({ length: 6, sets: digits }), Math.log2(1e6));
  const two = [{ id: 'a', chars: ['a'] }, { id: 'b', chars: ['b'] }];
  // Strings over {a,b} of length 3 containing both: 2^3 - 2 = 6.
  assert.equal(passwordEntropy({ length: 3, sets: two, requireEach: true }), Math.log2(6));
  assert.equal(passwordEntropy({ length: 3, sets: two, requireEach: false }), 3);
  const full = passwordEntropy({ length: 20, sets: buildSets(), requireEach: false });
  assert.ok(Math.abs(full - 20 * Math.log2(75)) < 1e-9, String(full));
  assert.ok(passwordEntropy({ length: 20, sets: buildSets(), requireEach: true }) < full);
  assert.ok(Math.abs(log2Big(1n << 200n) - 200) < 1e-12);
});

test('EFF word list is intact', () => {
  assert.equal(WORDS.length, 7776);
  assert.equal(new Set(WORDS).size, 7776);
  assert.equal(WORDS[0], 'abacus');
  assert.equal(WORDS[7775], 'zoom');
  assert.ok(WORDS.every((w) => /^[a-z-]+$/.test(w)));
});

test('passphrases', () => {
  const p = generatePassphrase({ words: 6, wordlist: WORDS });
  assert.equal(p.split('-').length >= 6, true);
  const fixed = generatePassphrase({ words: 3, wordlist: ['alpha', 'bravo', 'charlie'], separator: ' ', capitalizeWords: true, addNumber: true },
    replay([0, 1, 2, 1, 7]));
  assert.equal(fixed, 'Alpha Bravo7 Charlie');
  assert.ok(Math.abs(passphraseEntropy({ words: 6, wordlistSize: 7776 }) - 77.55) < 0.01);
  assert.ok(Math.abs(passphraseEntropy({ words: 6, wordlistSize: 7776, addNumber: true }) - (77.549 + Math.log2(60))) < 0.01);
});

test('strength labels and crack-time wording', () => {
  assert.equal(strength(30).label, 'Weak');
  assert.equal(strength(50).label, 'Fair');
  assert.equal(strength(70).label, 'Strong');
  assert.equal(strength(100).label, 'Very strong');
  assert.equal(crackTime(10), 'less than a second');
  assert.equal(crackTime(40), '55 seconds');
  assert.equal(crackTime(60), '2 years');
  assert.equal(crackTime(80), '2 million years');
  assert.equal(crackTime(200), 'longer than the age of the universe');
});
