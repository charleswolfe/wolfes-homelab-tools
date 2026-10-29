// JSON ↔ YAML conversion on top of the vendored js-yaml.
// js-yaml 4's default schema is safe: no !!js/function or other code-executing tags.
import { loadAll, dump } from '../vendor/js-yaml/js-yaml.mjs';
import { parseJson } from './json.js';

export class ConvertError extends Error {
  constructor(message, line = null, column = null) {
    super(message);
    this.line = line;
    this.column = column;
  }
}

export function yamlToJson(src, { indent = 2 } = {}) {
  let docs;
  try {
    docs = loadAll(src);
  } catch (err) {
    const m = err.mark;
    throw new ConvertError(err.reason || err.message, m ? m.line + 1 : null, m ? m.column + 1 : null);
  }
  docs = docs.filter((d) => d !== undefined);
  const value = docs.length === 0 ? null : docs.length === 1 ? docs[0] : docs;
  const json = JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v), indent || undefined);
  return { output: json ?? 'null', documents: docs.length };
}

export function jsonToYaml(src, { indent = 2, sortKeys = false } = {}) {
  let warnings;
  try {
    ({ warnings } = parseJson(src));
  } catch (err) {
    throw new ConvertError(err.message, err.line, err.column);
  }
  const value = JSON.parse(src.replace(/^﻿/, ''));
  const output = dump(value, { indent, sortKeys, lineWidth: -1, noRefs: true, noCompatMode: true });
  return { output, warnings };
}
