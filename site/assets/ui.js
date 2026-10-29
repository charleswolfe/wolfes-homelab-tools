// Small DOM helpers shared by tool pages.
import { icon } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// localStorage can be missing or throw (private windows, blocked storage);
// every caller gets a fallback instead of an exception.
export const storage = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem('hlt:' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem('hlt:' + key, JSON.stringify(value)); } catch { /* ignore */ }
  },
  remove(key) {
    try { localStorage.removeItem('hlt:' + key); } catch { /* ignore */ }
  },
};

export function debounce(fn, ms = 80) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

let toastHost;
export function toast(message, kind = 'ok') {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'toast-host';
    toastHost.setAttribute('role', 'status');
    toastHost.setAttribute('aria-live', 'polite');
    document.body.append(toastHost);
  }
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'error' ? ' is-error' : '');
  el.innerHTML = icon(kind === 'error' ? 'alert' : 'check');
  el.append(document.createTextNode(message));
  toastHost.append(el);
  setTimeout(() => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 220);
  }, 1800);
}

// navigator.clipboard only exists in secure contexts; plain-HTTP LAN
// deployments fall back to execCommand.
export async function copyText(text, button) {
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch { /* fall through */ }
  if (!ok) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.className = 'visually-hidden';
    document.body.append(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  toast(ok ? 'Copied to clipboard' : 'Copy failed. Select the text and copy manually.', ok ? 'ok' : 'error');
  if (ok && button) {
    button.classList.add('is-copied');
    setTimeout(() => button.classList.remove('is-copied'), 1200);
  }
  return ok;
}

export function downloadBlob(data, filename, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export const formatCount = (n, word, plural = word + 's') => `${n.toLocaleString()} ${n === 1 ? word : plural}`;

export async function readFileBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

// One label/value row with a copy button. `value` is plain text (escaped here).
export function kvRow(label, value, { sub = '', plain = false, muted = false, badge = '', copy = true, cls = '' } = {}) {
  const v = value == null || value === '' ? '' : String(value);
  return `<div class="kv${cls ? ' ' + cls : ''}">
    <span class="kv-label">${escapeHTML(label)}${sub ? ` <small>${escapeHTML(sub)}</small>` : ''}${badge}</span>
    <span class="kv-value${plain ? ' is-plain' : ''}${muted || !v ? ' is-muted' : ''}">${v ? escapeHTML(v) : '—'}</span>
    ${copy && v ? `<button class="btn btn-ghost btn-icon" type="button" data-copy="${escapeHTML(v)}" aria-label="Copy ${escapeHTML(label)}" title="Copy">${icon('copy')}</button>` : '<span></span>'}
  </div>`;
}

export function alertHTML(kind, message, { iconName = kind === 'ok' ? 'check' : 'alert', html = false } = {}) {
  return `<div class="alert alert-${kind}">${icon(iconName)}<div>${html ? message : escapeHTML(message)}</div></div>`;
}

// Any element with data-copy="text" copies that text when clicked.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-copy]');
  if (btn) copyText(btn.dataset.copy, btn);
});

// Syntax-colours pretty-printed JSON text for read-only display.
export function highlightJSON(text) {
  return escapeHTML(text).replace(
    /(&quot;(?:\\.|[^\\&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    (m, str, colon, lit) => {
      if (str) return colon ? `<span class="k">${str}</span>${colon}` : `<span class="s">${str}</span>`;
      if (lit) return `<span class="b">${lit}</span>`;
      return `<span class="n">${m}</span>`;
    },
  );
}

// Error message + source lines around it with a caret under the column.
// `frame` comes from codeFrame() in /lib/json.js.
export function codeErrorHTML(message, { line, column, frame }, { gotoButton = true } = {}) {
  const lines = frame.map((l) => {
    const text = escapeHTML(l.text);
    const caret = l.current ? `\n<span class="ln"></span>${' '.repeat(Math.max(0, column - 1))}<span class="caret">^</span>` : '';
    return `<div${l.current ? ' class="is-current"' : ''}><span class="ln">${l.n}</span>${text}${caret}</div>`;
  }).join('');
  return `<div class="alert alert-error">${icon('alert')}<div class="grow">
    <div>${escapeHTML(message)}</div>
    <div class="row-flex"><span>Line ${line}, column ${column}</span>${gotoButton ? '<button class="link" type="button" data-goto-error>Go to error</button>' : ''}</div>
    <pre class="code-frame">${lines}</pre>
  </div></div>`;
}

// Selects `pos` in a textarea and scrolls it into view.
export function revealPosition(textarea, pos, length = 1) {
  textarea.focus();
  textarea.setSelectionRange(pos, Math.min(pos + length, textarea.value.length));
  const line = textarea.value.slice(0, pos).split('\n').length;
  const lh = parseFloat(getComputedStyle(textarea).lineHeight) || 20;
  textarea.scrollTop = Math.max(0, (line - 3) * lh);
}
