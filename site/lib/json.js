// Strict JSON (RFC 8259) parser that builds a syntax tree with positions.
//
// Why not JSON.parse: its error messages differ per browser and often lack a
// line/column, and it silently loses precision on big integers and drops
// duplicate keys. Keeping raw number/string tokens lets the formatter
// reproduce the input exactly while re-indenting.

export class JsonSyntaxError extends Error {
  constructor(message, pos, src) {
    super(message);
    this.pos = pos;
    Object.assign(this, lineCol(src, pos));
  }
}

export function lineCol(src, pos) {
  let line = 1;
  let last = -1;
  for (let i = 0; i < pos && i < src.length; i++) {
    if (src.charCodeAt(i) === 10) { line++; last = i; }
  }
  return { line, column: pos - last };
}

const describeChar = (c) => {
  if (c === undefined) return 'end of input';
  const code = c.codePointAt(0);
  if (code < 0x20 || code === 0x7f) return `control character U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
  return `“${c}”`;
};

const MAX_SAFE = 2n ** 53n;

export function parseJson(src) {
  let i = 0;
  const warnings = [];
  const stack = []; // open containers, for "missing ]" messages
  const fail = (msg, at = i) => { throw new JsonSyntaxError(msg, at, src); };

  if (src.charCodeAt(0) === 0xfeff) {
    warnings.push({ message: 'Input starts with a byte-order mark (BOM); it was ignored.', pos: 0 });
    i = 1;
  }

  const ws = () => {
    for (;;) {
      const c = src.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) i++;
      else if (c === 47 && (src[i + 1] === '/' || src[i + 1] === '*')) fail('Comments are not allowed in JSON.');
      else break;
    }
  };

  function unexpected(context) {
    const c = src[i];
    if (c === undefined) {
      const open = stack[stack.length - 1];
      if (open) {
        const { line, column } = lineCol(src, open.pos);
        fail(`Unexpected end of input: ${open.type === 'object' ? '“}”' : '“]”'} missing for the ${open.type} opened at line ${line}, column ${column}.`);
      }
      fail(`Unexpected end of input${context ? ` ${context}` : ''}.`);
    }
    if (c === "'") fail('Strings must use double quotes ("), not single quotes.');
    if (/[A-Za-z_$]/.test(c)) {
      const word = /^[A-Za-z_$][\w$]*/.exec(src.slice(i))[0];
      if (['NaN', 'Infinity', 'undefined'].includes(word)) fail(`${word} is not valid in JSON. Use null or a string instead.`);
      if (/^(True|False|None|TRUE|FALSE|NULL|Null)$/.test(word)) fail(`“${word}” is not valid JSON. Literals are lowercase: true, false, null.`);
      fail(`Unexpected ${describeChar(c)}${context ? ` ${context}` : ''}. Text values must be in double quotes.`);
    }
    fail(`Unexpected ${describeChar(c)}${context ? ` ${context}` : ''}.`);
  }

  function value() {
    ws();
    const c = src[i];
    if (c === '{') return object();
    if (c === '[') return array();
    if (c === '"') return string();
    if (c === '-' || (c >= '0' && c <= '9')) return number();
    if (src.startsWith('true', i)) { i += 4; return { type: 'true' }; }
    if (src.startsWith('false', i)) { i += 5; return { type: 'false' }; }
    if (src.startsWith('null', i)) { i += 4; return { type: 'null' }; }
    if (c === '+') fail('Numbers cannot start with “+”.');
    if (c === '.') fail('Numbers need a digit before the decimal point (0.5, not .5).');
    return unexpected('where a value was expected');
  }

  function object() {
    const node = { type: 'object', members: [], pos: i };
    stack.push(node);
    i++;
    ws();
    if (src[i] === '}') { i++; stack.pop(); return node; }
    const seen = new Map();
    for (;;) {
      ws();
      if (src[i] === '}') fail('Trailing comma before “}” is not allowed.', src.lastIndexOf(',', i));
      if (src[i] !== '"') {
        if (src[i] !== undefined && /[A-Za-z_$]/.test(src[i])) fail('Property names must be in double quotes.');
        unexpected('where a property name was expected');
      }
      const keyPos = i;
      const key = string();
      if (seen.has(key.value)) {
        const first = lineCol(src, seen.get(key.value));
        warnings.push({ message: `Duplicate key “${key.value}” (first defined at line ${first.line}). Most parsers keep only the last value.`, pos: keyPos });
      } else {
        seen.set(key.value, keyPos);
      }
      ws();
      if (src[i] !== ':') {
        if (src[i] === '=') fail('Use “:” between a property name and its value, not “=”.');
        unexpected('after a property name; expected “:”');
      }
      i++;
      node.members.push({ key, value: value() });
      ws();
      if (src[i] === ',') { i++; continue; }
      if (src[i] === '}') { i++; stack.pop(); return node; }
      if (src[i] === '"') fail('Missing comma between properties.');
      unexpected('after a property value; expected “,” or “}”');
    }
  }

  function array() {
    const node = { type: 'array', items: [], pos: i };
    stack.push(node);
    i++;
    ws();
    if (src[i] === ']') { i++; stack.pop(); return node; }
    for (;;) {
      ws();
      if (src[i] === ']') fail('Trailing comma before “]” is not allowed.', src.lastIndexOf(',', i));
      node.items.push(value());
      ws();
      if (src[i] === ',') { i++; continue; }
      if (src[i] === ']') { i++; stack.pop(); return node; }
      if (src[i] !== undefined && /["{[\d-]|t|f|n/.test(src[i])) fail('Missing comma between array items.');
      unexpected('after an array item; expected “,” or “]”');
    }
  }

  function string() {
    const start = i;
    i++;
    let out = '';
    let chunk = i;
    for (;;) {
      const c = src.charCodeAt(i);
      if (Number.isNaN(c)) fail('Unterminated string: missing closing quote.', start);
      if (c === 34) { out += src.slice(chunk, i); i++; break; }
      if (c < 0x20) {
        const name = { 10: '\\n', 13: '\\r', 9: '\\t' }[c];
        fail(`Unescaped ${describeChar(src[i])} inside a string${name ? `; write it as ${name}` : ''}.`);
      }
      if (c === 92) {
        out += src.slice(chunk, i);
        const e = src[i + 1];
        const simple = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }[e];
        if (simple !== undefined) { out += simple; i += 2; }
        else if (e === 'u') {
          const hex = src.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('Invalid \\u escape: expected four hex digits.');
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
        } else {
          fail(`Invalid escape “\\${e ?? ''}”. Valid escapes: \\" \\\\ \\/ \\b \\f \\n \\r \\t \\uXXXX.`);
        }
        chunk = i;
        continue;
      }
      i++;
    }
    return { type: 'string', raw: src.slice(start, i), value: out };
  }

  function number() {
    const start = i;
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(src.slice(i, i + 400));
    if (!m) fail(src[i] === '-' ? 'Expected a digit after “-”.' : 'Invalid number.');
    if (/^-?0\d/.test(src.slice(i, i + 3))) fail('Numbers cannot have leading zeros.');
    i += m[0].length;
    if (src[i] === '.') fail('Expected digits after the decimal point.');
    const raw = m[0];
    if (!m[2] && !m[3]) {
      const n = BigInt(raw);
      if (n >= MAX_SAFE || n <= -MAX_SAFE) {
        warnings.push({ message: `Integer ${raw} is larger than 2^53; JavaScript and many other parsers will round it.`, pos: start });
      }
    }
    return { type: 'number', raw };
  }

  let ast;
  try {
    ws();
    if (i >= src.length) fail('Input is empty.');
    ast = value();
    ws();
    if (i < src.length) {
      if (src[i] === ',' || src[i] === '{' || src[i] === '[') fail('Unexpected data after the top-level value. Wrap multiple values in an array.');
      unexpected('after the top-level value');
    }
  } catch (err) {
    if (err instanceof RangeError) throw new JsonSyntaxError('Nesting is too deep to process.', i, src);
    throw err;
  }
  return { ast, warnings };
}

// indent: '' (minify), '  ', '    ', or '\t'
export function formatAst(ast, { indent = '  ', sortKeys = false } = {}) {
  const nl = indent ? '\n' : '';
  const colon = indent ? ': ' : ':';
  const out = [];
  const walk = (node, depth) => {
    switch (node.type) {
      case 'object': {
        if (!node.members.length) { out.push('{}'); return; }
        const members = sortKeys
          ? [...node.members].sort((a, b) => (a.key.value < b.key.value ? -1 : a.key.value > b.key.value ? 1 : 0))
          : node.members;
        const pad = indent.repeat(depth + 1);
        out.push('{', nl);
        members.forEach((m, idx) => {
          out.push(pad, m.key.raw, colon);
          walk(m.value, depth + 1);
          out.push(idx < members.length - 1 ? ',' : '', nl);
        });
        out.push(indent.repeat(depth), '}');
        return;
      }
      case 'array': {
        if (!node.items.length) { out.push('[]'); return; }
        const pad = indent.repeat(depth + 1);
        out.push('[', nl);
        node.items.forEach((item, idx) => {
          out.push(pad);
          walk(item, depth + 1);
          out.push(idx < node.items.length - 1 ? ',' : '', nl);
        });
        out.push(indent.repeat(depth), ']');
        return;
      }
      case 'string':
      case 'number':
        out.push(node.raw);
        return;
      default:
        out.push(node.type);
    }
  };
  walk(ast, 0);
  return out.join('');
}

export function stats(ast) {
  let objects = 0, arrays = 0, keys = 0, values = 0, maxDepth = 0;
  const walk = (n, d) => {
    maxDepth = Math.max(maxDepth, d);
    if (n.type === 'object') { objects++; keys += n.members.length; n.members.forEach((m) => walk(m.value, d + 1)); }
    else if (n.type === 'array') { arrays++; n.items.forEach((x) => walk(x, d + 1)); }
    else values++;
  };
  walk(ast, 0);
  return { objects, arrays, keys, values, depth: maxDepth };
}

// Lines around a position, for showing an error in context.
export function codeFrame(src, pos, context = 2) {
  const { line, column } = lineCol(src, pos);
  const lines = src.split('\n');
  const from = Math.max(1, line - context);
  const to = Math.min(lines.length, line + context);
  const frame = [];
  for (let n = from; n <= to; n++) frame.push({ n, text: lines[n - 1].replace(/\r$/, ''), current: n === line });
  return { line, column, frame };
}

export function posFromLineCol(src, line, column) {
  let pos = 0;
  for (let n = 1; n < line; n++) {
    const nl = src.indexOf('\n', pos);
    if (nl === -1) return src.length;
    pos = nl + 1;
  }
  return Math.min(pos + column - 1, src.length);
}
