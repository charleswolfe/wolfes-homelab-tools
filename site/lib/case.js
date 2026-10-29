// Identifier / text case conversion and slugify.

// "XMLHttpRequest v2_final-Draft" → ["XML", "Http", "Request", "v2", "final", "Draft"]
export function splitWords(input) {
  return input
    .replace(/['’]/g, '')
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const lower = (w) => w.toLowerCase();
const upper = (w) => w.toUpperCase();
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

// Words kept lowercase in Title Case unless first or last (Chicago-ish).
const SMALL_WORDS = new Set('a an and as at but by en for if in nor of on or per the to v vs via'.split(' '));

export function titleCase(text) {
  const parts = text.toLowerCase().split(/(\s+)/);
  const wordIdx = parts.map((p, i) => (/\S/.test(p) ? i : -1)).filter((i) => i >= 0);
  const first = wordIdx[0];
  const last = wordIdx[wordIdx.length - 1];
  return parts.map((p, i) => {
    if (!/\S/.test(p)) return p;
    const bare = p.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (i !== first && i !== last && SMALL_WORDS.has(bare)) return p;
    return p.replace(/\p{L}/u, (c) => c.toUpperCase());
  }).join('');
}

export function sentenceCase(text) {
  return text.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_, pre, c) => pre + c.toUpperCase());
}

const FOLD = { ß: 'ss', æ: 'ae', Æ: 'AE', ø: 'o', Ø: 'O', œ: 'oe', Œ: 'OE', đ: 'd', Đ: 'D', ł: 'l', Ł: 'L', þ: 'th', Þ: 'TH', ð: 'd', Ð: 'D' };

export function slugify(text, { separator = '-', lowercase = true } = {}) {
  let s = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ßæÆøØœŒđĐłŁþÞðÐ]/g, (c) => FOLD[c])
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '');
  s = s.replace(/[^A-Za-z0-9]+/g, separator);
  const esc = separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (separator) s = s.replace(new RegExp(`^(${esc})+|(${esc})+$`, 'g'), '');
  return lowercase ? s.toLowerCase() : s;
}

export const CASES = [
  { id: 'slug', label: 'slug', fn: (s) => slugify(s) },
  { id: 'camel', label: 'camelCase', fn: (s) => splitWords(s).map((w, i) => (i ? cap(w) : lower(w))).join('') },
  { id: 'pascal', label: 'PascalCase', fn: (s) => splitWords(s).map(cap).join('') },
  { id: 'snake', label: 'snake_case', fn: (s) => splitWords(s).map(lower).join('_') },
  { id: 'constant', label: 'CONSTANT_CASE', fn: (s) => splitWords(s).map(upper).join('_') },
  { id: 'kebab', label: 'kebab-case', fn: (s) => splitWords(s).map(lower).join('-') },
  { id: 'train', label: 'Train-Case', fn: (s) => splitWords(s).map(cap).join('-') },
  { id: 'dot', label: 'dot.case', fn: (s) => splitWords(s).map(lower).join('.') },
  { id: 'path', label: 'path/case', fn: (s) => splitWords(s).map(lower).join('/') },
  { id: 'title', label: 'Title Case', fn: titleCase },
  { id: 'sentence', label: 'Sentence case', fn: sentenceCase },
  { id: 'lower', label: 'lower case', fn: lower },
  { id: 'upper', label: 'UPPER CASE', fn: upper },
];

// Converts every line independently so lists of identifiers work in bulk.
export const convertLines = (text, fn) => text.split('\n').map((line) => (line.trim() ? fn(line) : line)).join('\n');
