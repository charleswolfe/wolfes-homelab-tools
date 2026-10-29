// Regex execution for the tester. Runs inside a Web Worker in the browser so a
// catastrophically backtracking pattern can be killed without freezing the tab.

export const FLAGS = [
  { flag: 'g', name: 'global', hint: 'Find all matches, not just the first' },
  { flag: 'i', name: 'ignore case', hint: 'Case-insensitive' },
  { flag: 'm', name: 'multiline', hint: '^ and $ match at line breaks' },
  { flag: 's', name: 'dotAll', hint: '. also matches newlines' },
  { flag: 'u', name: 'unicode', hint: 'Full Unicode; stricter syntax' },
  { flag: 'y', name: 'sticky', hint: 'Match only at lastIndex' },
];

export function compile(pattern, flags) {
  try {
    return new RegExp(pattern, flags);
  } catch (err) {
    throw new Error(err.message.replace(/^Invalid regular expression: /, ''));
  }
}

export function run(pattern, flags, text, { replacement = null, maxMatches = 5000 } = {}) {
  const re = compile(pattern, flags);
  const matches = [];
  let truncated = false;

  if (re.global || re.sticky) {
    // matchAll requires g; emulate sticky-only by stopping at the first gap.
    const iter = re.global ? text.matchAll(re) : (function* () {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        yield m;
        if (m[0] === '') re.lastIndex++;
      }
    })();
    for (const m of iter) {
      if (matches.length >= maxMatches) { truncated = true; break; }
      matches.push(toMatch(m));
    }
  } else {
    const m = re.exec(text);
    if (m) matches.push(toMatch(m));
  }

  let replaced = null;
  if (replacement !== null) {
    replaced = text.replace(compile(pattern, flags), replacement);
  }
  return { matches, truncated, replaced, groupNames: groupNames(pattern) };
}

function toMatch(m) {
  return {
    index: m.index,
    end: m.index + m[0].length,
    text: m[0],
    groups: m.slice(1).map((g) => (g === undefined ? null : g)),
    named: m.groups ? { ...m.groups } : null,
  };
}

// Name (or null) for each capturing group, in group-number order. Skips
// escapes and character classes, where "(" is literal.
export function groupNames(pattern) {
  const names = [];
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') { i++; continue; }
    if (inClass) { if (c === ']') inClass = false; continue; }
    if (c === '[') { inClass = true; continue; }
    if (c !== '(') continue;
    if (pattern[i + 1] !== '?') { names.push(null); continue; }
    const named = /^\(\?<([A-Za-z_$][\w$]*)>/.exec(pattern.slice(i));
    if (named) names.push(named[1]);
  }
  return names;
}
