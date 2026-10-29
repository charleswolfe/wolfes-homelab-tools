// Index page: category cards, live filter and "recently used" chips.
import { categories, tools, toolsIn, toolById, searchTools } from './tools.js';
import { icon } from './icons.js';
import { $, storage } from './ui.js';
import { toolLinkHTML } from './shell.js';

const grid = $('#categories');
const filter = $('#filter');
const empty = $('#empty');

function renderCategories(visible) {
  const ids = visible ? new Set(visible.map((t) => t.id)) : null;
  let shown = 0;
  grid.innerHTML = categories.map((cat) => {
    const list = toolsIn(cat.id).filter((t) => !ids || ids.has(t.id));
    if (!list.length) return '';
    shown += list.length;
    const ready = toolsIn(cat.id).filter((t) => t.ready).length;
    return `
      <section class="cat-card cat-${cat.id}" aria-labelledby="cat-${cat.id}">
        <header class="cat-head">
          <span class="cat-icon">${icon(cat.icon)}</span>
          <div>
            <h2 id="cat-${cat.id}">${cat.name}</h2>
            <p>${cat.blurb}</p>
          </div>
          <span class="cat-count" title="${ready} of ${toolsIn(cat.id).length} available">${toolsIn(cat.id).length}</span>
        </header>
        <ul class="cat-tools">
          ${list.map((t) => `<li>${toolLinkHTML(t).replace(/<\/a>$/, `<span class="tool-link-go">${icon('chevronRight')}</span></a>`)}</li>`).join('')}
        </ul>
      </section>`;
  }).join('');
  empty.hidden = shown > 0;
}

function renderRecent() {
  const host = $('#recent');
  const recent = storage.get('recent', []).map(toolById).filter((t) => t && t.ready);
  if (!recent.length) return;
  host.innerHTML = '<span class="recent-label">Recently used</span>' + recent.map((t) => `
    <a class="chip cat-${t.category}" href="${t.path}"><span class="chip-icon">${icon(t.icon)}</span>${t.name}</a>`).join('');
  host.hidden = false;
}

filter.addEventListener('input', () => {
  const q = filter.value.trim();
  renderCategories(q ? searchTools(q, tools) : null);
});

// Enter jumps straight to the best available match.
filter.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { filter.value = ''; renderCategories(null); return; }
  if (e.key !== 'Enter') return;
  const best = searchTools(filter.value.trim()).find((t) => t.ready);
  if (best) location.href = best.path;
});

// On the index, "/" focuses the inline filter instead of opening the palette.
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.target === filter) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  filter.focus();
}, true);

renderCategories(null);
renderRecent();
