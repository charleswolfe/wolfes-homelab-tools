import { FLAGS, compile } from '/lib/regex.js';
import { $, $$, storage, debounce, copyText, alertHTML, escapeHTML, formatCount } from '/assets/ui.js';

const TIMEOUT_MS = 1000;
const LIST_LIMIT = 200;

const el = {
  pattern: $('#pattern'),
  patternBar: $('#pattern-bar'),
  flags: $('#flags'),
  flagsText: $('#flags-text'),
  text: $('#text'),
  backdrop: $('#backdrop'),
  messages: $('#messages'),
  matchCount: $('#match-count'),
  matches: $('#matches'),
  matchesMeta: $('#matches-meta'),
  replacement: $('#replacement'),
  replaced: $('#replaced'),
};

const DEFAULTS = {
  pattern: '(?<user>[\\w.+-]+)@(?<domain>[\\w-]+(?:\\.[\\w-]+)+)',
  flags: 'g',
  text: 'Contact admin@homelab.lan or ops.team+alerts@example.com.\nNot an email: @nobody, someone@\nBackup: backups@nas.local',
  replacement: '',
};
const saved = { ...DEFAULTS, ...storage.get('regex', {}) };

el.flags.innerHTML = FLAGS.map((f) => `<label class="flag-toggle" title="${escapeHTML(f.hint)}">
  <input type="checkbox" value="${f.flag}"${saved.flags.includes(f.flag) ? ' checked' : ''}><span><b>${f.flag}</b>${f.name}</span></label>`).join('');
el.pattern.value = saved.pattern;
el.text.value = saved.text;
el.replacement.value = saved.replacement;

const flags = () => $$('input', el.flags).filter((c) => c.checked).map((c) => c.value).join('');

// ---------- worker with timeout ----------

let worker = null;
let pending = null; // { id, timer }
let seq = 0;

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (!pending || data.id !== pending.id) return;
      clearTimeout(pending.timer);
      pending = null;
      if (data.ok) show(data.result);
      else showError(data.error);
    };
  }
  return worker;
}

function execute() {
  const pattern = el.pattern.value;
  const f = flags();
  el.flagsText.textContent = f;
  storage.set('regex', { pattern, flags: f, text: el.text.value.slice(0, 20000), replacement: el.replacement.value });

  if (!pattern) {
    el.patternBar.classList.remove('is-invalid');
    el.messages.innerHTML = '';
    show({ matches: [], truncated: false, replaced: null, groupNames: [] }, true);
    return;
  }
  // Compile on the main thread first: syntax errors are instant and safe.
  try {
    compile(pattern, f);
  } catch (err) {
    showError(err.message);
    return;
  }

  if (pending) clearTimeout(pending.timer);
  const id = ++seq;
  const timer = setTimeout(() => {
    // Hung: kill the worker; a fresh one is created on the next run.
    worker.terminate();
    worker = null;
    pending = null;
    showError(`Stopped after ${TIMEOUT_MS / 1000} s. The pattern is probably backtracking catastrophically (for example nested quantifiers like (a+)+). Try making it more specific.`);
  }, TIMEOUT_MS);
  pending = { id, timer };
  getWorker().postMessage({ id, pattern, flags: f, text: el.text.value, replacement: el.replacement.value === '' ? null : el.replacement.value });
}

// ---------- rendering ----------

function showError(message) {
  el.patternBar.classList.add('is-invalid');
  el.messages.innerHTML = alertHTML('error', message);
  el.backdrop.innerHTML = escapeHTML(el.text.value) + '\n';
  el.matchCount.textContent = '';
  el.matches.innerHTML = '';
  el.matchesMeta.textContent = '';
}

function show(result, empty = false) {
  el.patternBar.classList.remove('is-invalid');
  el.messages.innerHTML = '';
  const { matches, truncated, replaced, groupNames } = result;
  const text = el.text.value;

  // Backdrop: same text with <mark>s, so highlights line up under the textarea.
  let html = '';
  let at = 0;
  matches.forEach((m, i) => {
    html += escapeHTML(text.slice(at, m.index));
    html += m.end === m.index
      ? '<mark class="empty"></mark>'
      : `<mark${i % 2 ? ' class="alt"' : ''}>${escapeHTML(text.slice(m.index, m.end))}</mark>`;
    at = m.end;
  });
  el.backdrop.innerHTML = html + escapeHTML(text.slice(at)) + '\n';

  const n = matches.length;
  el.matchCount.textContent = empty ? '' : `${formatCount(n, 'match', 'matches')}${truncated ? '+' : ''}`;
  el.matchesMeta.textContent = n > LIST_LIMIT ? `showing first ${LIST_LIMIT}` : '';
  el.matches.innerHTML = empty
    ? '<li class="hint">Enter a pattern to see matches.</li>'
    : !n
      ? '<li class="hint">No matches.</li>'
      : matches.slice(0, LIST_LIMIT).map((m, i) => {
        const groups = m.groups.map((g, gi) => {
          const name = groupNames[gi];
          return `<dt>${gi + 1}${name ? ` &lt;${escapeHTML(name)}&gt;` : ''}</dt><dd>${g === null ? '<span class="null">undefined</span>' : escapeHTML(g) || '<span class="null">empty</span>'}</dd>`;
        }).join('');
        return `<li><div class="match-head"><span class="match-text">${escapeHTML(m.text) || '<span class="null">empty match</span>'}</span>
          <span class="at">#${i + 1} · index ${m.index}–${m.end}</span></div>${groups ? `<dl class="match-groups">${groups}</dl>` : ''}</li>`;
      }).join('');

  el.replaced.value = replaced ?? '';
  autosize();
}

function autosize() {
  el.text.style.height = 'auto';
  el.text.style.height = `${Math.max(200, el.text.scrollHeight + 2)}px`;
}

const runSoon = debounce(execute, 120);
el.pattern.addEventListener('input', runSoon);
el.text.addEventListener('input', () => { autosize(); runSoon(); });
el.replacement.addEventListener('input', runSoon);
el.flags.addEventListener('change', execute);
$('#copy-replaced').addEventListener('click', (e) => copyText(el.replaced.value, e.currentTarget));
window.addEventListener('resize', debounce(autosize, 100));

execute();
