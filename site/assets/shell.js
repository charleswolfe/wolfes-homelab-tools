// Renders the shared chrome on every page: header with category menus,
// mobile drawer, Ctrl/⌘K search palette, theme toggle, breadcrumbs, footer.
//
// Page contract:
//   <body data-tool="base64">        tool id from tools.js (omit on the index)
//   <header data-shell-header>       filled with the site header
//   <nav data-crumbs>                filled with the breadcrumb
//   <span data-tool-icon>            filled with the tool's icon badge
//   <footer data-shell-footer>       filled with the site footer
//   <span data-icon="name">          replaced with that inline SVG icon
import { SITE, categories, tools, toolById, categoryById, toolsIn, searchTools } from './tools.js';
import { icon } from './icons.js';
import { $, $$, storage, escapeHTML } from './ui.js';
import { initTheme, currentTheme, themeOrder, themeIcons, themeLabels } from './theme.js';

const isMac = /Mac|iPhone|iPad/i.test(navigator.userAgentData?.platform || navigator.platform || '');
const shortcutLabel = isMac ? '⌘K' : 'Ctrl K';
const currentTool = toolById(document.body.dataset.tool || '');

// ---------- shared markup ----------

// isSecureContext is true for HTTPS and for localhost, which is exactly when
// browsers unlock WebHID, crypto.subtle, clipboard writes and friends.
const insecure = !window.isSecureContext;

export function toolLinkHTML(tool) {
  let badge = '';
  if (!tool.ready) badge = '<span class="badge">Soon</span>';
  else if (insecure && tool.https?.level === 'required') badge = '<span class="badge badge-warn">Needs HTTPS</span>';
  const inner = `
    <span class="tool-link-icon">${icon(tool.icon)}</span>
    <span class="tool-link-text">
      <span class="tool-link-name">${tool.name}${badge}</span>
      <span class="tool-link-desc">${tool.summary}</span>
    </span>`;
  if (!tool.ready) {
    return `<span class="tool-link cat-${tool.category} is-soon" aria-disabled="true">${inner}</span>`;
  }
  const current = currentTool && currentTool.id === tool.id ? ' aria-current="page"' : '';
  return `<a class="tool-link cat-${tool.category}" href="${tool.path}"${current}>${inner}</a>`;
}

// ---------- header ----------

function renderHeader(host) {
  const menus = categories.map((cat) => `
    <div class="nav-item">
      <button class="nav-btn${currentTool?.category === cat.id ? ' is-current' : ''}" type="button"
        aria-expanded="false" aria-controls="menu-${cat.id}">${cat.short}${icon('chevronDown')}</button>
      <div class="nav-pop" id="menu-${cat.id}" hidden>
        <p class="nav-pop-head">${cat.blurb}</p>
        ${toolsIn(cat.id).map((t) => toolLinkHTML(t)).join('')}
      </div>
    </div>`).join('');

  host.classList.add('site-header');
  host.innerHTML = `
    <div class="container header-inner">
      <a class="brand" href="/" aria-label="${SITE.name} home">
        <span class="brand-mark">${icon('logo')}</span>
        <span class="brand-name">${SITE.name}</span>
      </a>
      <nav class="nav" aria-label="Tool categories">${menus}</nav>
      <div class="header-actions">
        <button class="search-trigger" type="button" data-open-palette aria-label="Search tools (${shortcutLabel})">
          ${icon('search')}<span class="search-label">Search tools…</span><kbd>${shortcutLabel}</kbd>
        </button>
        <button class="icon-btn" type="button" data-theme-toggle></button>
        <button class="icon-btn menu-btn" type="button" data-open-drawer aria-label="Open menu">${icon('menu')}</button>
      </div>
    </div>`;

  // Category popovers: click to toggle, close on outside click / Escape.
  const buttons = $$('.nav-btn', host);
  const closeAll = (except) => buttons.forEach((b) => {
    if (b === except) return;
    b.setAttribute('aria-expanded', 'false');
    document.getElementById(b.getAttribute('aria-controls')).hidden = true;
  });
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      closeAll(btn);
      btn.setAttribute('aria-expanded', String(!open));
      document.getElementById(btn.getAttribute('aria-controls')).hidden = open;
    });
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.nav-item')) closeAll(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = buttons.find((b) => b.getAttribute('aria-expanded') === 'true');
    if (open) { closeAll(); open.focus(); }
  });
}

function themePickerHTML() {
  return `
    <div class="segmented segmented-full" role="radiogroup" aria-label="Theme">
      ${themeOrder.map((t) => `<label><input type="radio" name="theme-choice" value="${t}"${t === currentTheme() ? ' checked' : ''}><span>${icon(themeIcons[t])}${themeLabels[t]}</span></label>`).join('')}
    </div>`;
}

// ---------- mobile drawer ----------

function initDrawer() {
  const drawer = document.createElement('dialog');
  drawer.className = 'drawer';
  drawer.setAttribute('aria-label', 'Menu');
  drawer.innerHTML = `
    <div class="drawer-head">
      <a class="brand" href="/"><span class="brand-mark">${icon('logo')}</span><span class="brand-name">${SITE.name}</span></a>
      <button class="icon-btn" type="button" data-close aria-label="Close menu">${icon('close')}</button>
    </div>
    ${categories.map((cat) => `
      <section class="drawer-section">
        <h2>${cat.name}</h2>
        ${toolsIn(cat.id).map((t) => toolLinkHTML(t)).join('')}
      </section>`).join('')}
    <section class="drawer-section drawer-appearance">
      <h2>Appearance</h2>
      ${themePickerHTML()}
    </section>`;
  document.body.append(drawer);

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-drawer]')) drawer.showModal();
  });
  drawer.addEventListener('click', (e) => {
    // Clicks on the backdrop land on the <dialog> itself.
    if (e.target === drawer || e.target.closest('[data-close]')) drawer.close();
  });
}

// ---------- search palette ----------

function initPalette() {
  const dlg = document.createElement('dialog');
  dlg.className = 'palette';
  dlg.setAttribute('aria-label', 'Search tools');
  dlg.innerHTML = `
    <div class="palette-search">
      ${icon('search')}
      <input type="text" placeholder="Search tools…" autocomplete="off" spellcheck="false"
        role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list">
      <kbd>Esc</kbd>
    </div>
    <div class="palette-list" id="palette-list" role="listbox"></div>
    <div class="palette-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span></div>`;
  document.body.append(dlg);

  const input = $('input', dlg);
  const list = $('.palette-list', dlg);
  let results = [];
  let active = 0;

  function render() {
    const q = input.value.trim();
    results = searchTools(q).filter((t) => t.ready);
    active = Math.min(active, Math.max(results.length - 1, 0));
    if (!results.length) {
      list.innerHTML = `<p class="palette-empty">No tools match “${q.replace(/[<&]/g, '')}”.</p>`;
      input.removeAttribute('aria-activedescendant');
      return;
    }
    // Without a query, group by category; with one, show a ranked flat list.
    let html = '';
    let lastCat = null;
    results.forEach((t, i) => {
      if (!q && t.category !== lastCat) {
        html += `<div class="palette-group">${categoryById(t.category).name}</div>`;
        lastCat = t.category;
      }
      html += `<a class="tool-link cat-${t.category}" href="${t.path}" id="pal-${t.id}" role="option"
        aria-selected="${i === active}" data-index="${i}">
        <span class="tool-link-icon">${icon(t.icon)}</span>
        <span class="tool-link-text"><span class="tool-link-name">${t.name}</span>
        <span class="tool-link-desc">${t.summary}</span></span></a>`;
    });
    list.innerHTML = html;
    input.setAttribute('aria-activedescendant', `pal-${results[active].id}`);
  }

  function move(delta) {
    if (!results.length) return;
    active = (active + delta + results.length) % results.length;
    $$('[role=option]', list).forEach((el, i) => el.setAttribute('aria-selected', String(i === active)));
    const el = $(`[data-index="${active}"]`, list);
    el.scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', el.id);
  }

  function open() {
    if (dlg.open) return;
    input.value = '';
    active = 0;
    render();
    dlg.showModal();
    input.focus();
  }

  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter' && results[active]) { e.preventDefault(); location.href = results[active].path; }
  });
  list.addEventListener('mousemove', (e) => {
    const opt = e.target.closest('[role=option]');
    if (opt && Number(opt.dataset.index) !== active) move(Number(opt.dataset.index) - active);
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  document.addEventListener('click', (e) => { if (e.target.closest('[data-open-palette]')) open(); });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (dlg.open) dlg.close(); else open();
      return;
    }
    const t = e.target;
    const typing = t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      open();
    }
  });
}

// ---------- per-page bits ----------

function renderCrumbs() {
  const host = $('[data-crumbs]');
  if (!host || !currentTool) return;
  const cat = categoryById(currentTool.category);
  host.innerHTML = `<a href="/">Home</a>${icon('chevronRight')}<span>${cat.name}</span>${icon('chevronRight')}<span aria-current="page">${currentTool.name}</span>`;
}

function renderToolIcon() {
  const host = $('[data-tool-icon]');
  if (!host || !currentTool) return;
  host.classList.add('tool-head-icon', `cat-${currentTool.category}`);
  host.innerHTML = icon(currentTool.icon);
}

// Banner at the top of the page when a tool that needs (or should have)
// HTTPS is opened over plain HTTP.
// Shown on any plain-http:// address. On localhost the browser still treats
// the page as secure, so the tool works, but other devices won't get that.
function renderHttpsNotice() {
  const req = currentTool?.https;
  if (!req || location.protocol !== 'http:') return;
  const main = $('main');
  if (!main) return;
  const required = req.level === 'required';
  const secureUrl = `https://${location.hostname}${location.pathname}${location.search}`;
  let title = required ? 'This tool needs a secure (HTTPS) connection.' : 'Use HTTPS for this tool.';
  let body = escapeHTML(req.reason);
  if (!insecure) {
    title = 'You’re on plain HTTP.';
    body = `It works here only because you’re browsing on the server itself (localhost), which browsers treat as secure. Other devices on your network won’t get that. ${body}`;
  }
  const notice = document.createElement('div');
  notice.className = `alert ${required && insecure ? 'alert-error' : 'alert-warn'} https-notice`;
  notice.setAttribute('role', 'alert');
  notice.innerHTML = `${icon(required && insecure ? 'alert' : 'shield')}<div>
    <strong>${title}</strong>
    ${body} You are on <code>${escapeHTML(location.protocol)}//${escapeHTML(location.host)}</code>.
    <span class="https-actions"><a href="${escapeHTML(secureUrl)}">Open with HTTPS</a> · If that link fails, HTTPS isn’t set up on this server yet (see docs/https.md in the project).</span>
  </div>`;
  main.prepend(notice);
}

function renderFooter() {
  const host = $('[data-shell-footer]');
  if (!host) return;
  host.classList.add('site-footer');
  host.innerHTML = `
    <div class="container footer-inner">
      <p class="footer-note">${icon('unlock')}<span>Free to use, fork and share. <a href="/license.txt">License</a></span></p>
      <p>${tools.length} tools · ${categories.length} categories</p>
    </div>`;
}

function hydrateIcons(root = document) {
  $$('[data-icon]', root).forEach((el) => {
    el.outerHTML = icon(el.dataset.icon);
  });
}

function recordRecent() {
  if (!currentTool) return;
  const recent = storage.get('recent', []).filter((id) => id !== currentTool.id && toolById(id));
  recent.unshift(currentTool.id);
  storage.set('recent', recent.slice(0, 6));
}

const header = $('[data-shell-header]');
if (header) renderHeader(header);
initTheme();
initDrawer();
initPalette();
renderCrumbs();
renderToolIcon();
renderHttpsNotice();
renderFooter();
hydrateIcons();
recordRecent();
