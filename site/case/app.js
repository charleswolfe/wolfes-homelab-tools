import { CASES, slugify, convertLines } from '/lib/case.js';
import { $, storage, debounce, escapeHTML } from '/assets/ui.js';
import { icon } from '/assets/icons.js';

const input = $('#input');
const results = $('#results');
const separator = $('#separator');
const keepCase = $('#opt-keepcase');

const EXAMPLES = ['XMLHttpRequest handler', 'user account settings', 'Crème brûlée recipe: 2nd edition!', 'MAX_RETRY_COUNT', 'the lord of the rings'];
let exampleIdx = 0;

const saved = storage.get('case', {});
separator.value = saved.separator ?? '-';
keepCase.checked = !!saved.keepCase;

function convert(c, text) {
  if (c.id === 'slug') return convertLines(text, (line) => slugify(line, { separator: separator.value, lowercase: !keepCase.checked }));
  return convertLines(text, c.fn);
}

function render() {
  const text = input.value;
  results.innerHTML = CASES.map((c) => {
    const out = text ? convert(c, text) : '';
    return `<div class="mini-card">
      <div class="mini-card-head">${escapeHTML(c.label)}
        <button class="btn btn-ghost btn-icon" type="button" ${out ? `data-copy="${escapeHTML(out)}"` : 'disabled'} aria-label="Copy ${escapeHTML(c.label)}" title="Copy">${icon('copy')}</button>
      </div>
      <div class="mini-card-value">${escapeHTML(out)}</div>
    </div>`;
  }).join('');
}

const persist = () => storage.set('case', { separator: separator.value, keepCase: keepCase.checked });

input.addEventListener('input', debounce(render, 40));
separator.addEventListener('change', () => { persist(); render(); });
keepCase.addEventListener('change', () => { persist(); render(); });
$('#clear').addEventListener('click', () => { input.value = ''; render(); input.focus(); });
$('#example').addEventListener('click', () => {
  input.value = EXAMPLES[exampleIdx++ % EXAMPLES.length];
  render();
});

render();
