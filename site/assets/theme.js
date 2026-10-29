// Theme switching (system → light → dark), shared by shell.js and the VIA
// skin. theme-init.js applies the saved choice before first paint; this keeps
// toggles, pickers, the browser's theme-color and other tabs in sync.
//   <button data-theme-toggle>          cycles the theme
//   <input name="theme-choice" value>   radio picker
import { icon } from './icons.js';
import { $$, storage } from './ui.js';

export const themeOrder = ['system', 'light', 'dark'];
export const themeIcons = { system: 'monitor', light: 'sun', dark: 'moon' };
export const themeLabels = { system: 'System', light: 'Light', dark: 'Dark' };
const themeMetas = $$('meta[name="theme-color"]');
themeMetas.forEach((m) => { m.dataset.systemColor = m.content; });
let theme = 'system';
export const currentTheme = () => theme;

const readTheme = () => {
  const t = storage.get('theme', 'system');
  return themeOrder.includes(t) ? t : 'system';
};

function applyTheme(next) {
  theme = next;
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);

  // Browser chrome (mobile address bar) follows a forced theme too, not just
  // the OS setting the media-qualified <meta> tags describe.
  const forced = theme === 'system' ? null : getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  themeMetas.forEach((m) => { m.content = forced || m.dataset.systemColor; });

  const upcoming = themeOrder[(themeOrder.indexOf(theme) + 1) % themeOrder.length];
  $$('[data-theme-toggle]').forEach((btn) => {
    btn.innerHTML = icon(themeIcons[theme]);
    btn.setAttribute('aria-label', `Theme: ${themeLabels[theme]}. Switch to ${themeLabels[upcoming]}.`);
    btn.title = `Theme: ${themeLabels[theme]} (click for ${themeLabels[upcoming]})`;
  });
  $$('input[name="theme-choice"]').forEach((r) => { r.checked = r.value === theme; });
}

function setTheme(next) {
  if (next === 'system') storage.remove('theme'); else storage.set('theme', next);
  applyTheme(next);
}

export function initTheme() {
  applyTheme(readTheme());
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-theme-toggle]')) return;
    setTheme(themeOrder[(themeOrder.indexOf(theme) + 1) % themeOrder.length]);
  });
  document.addEventListener('change', (e) => {
    if (e.target.name === 'theme-choice') setTheme(e.target.value);
  });
  // Keep other open tabs in sync.
  window.addEventListener('storage', (e) => {
    if (e.key === null || e.key === 'hlt:theme') applyTheme(readTheme());
  });
}
