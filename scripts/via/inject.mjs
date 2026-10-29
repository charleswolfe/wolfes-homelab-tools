// Wraps the built VIA app in the Homelab Tools chrome. Edits
// site/via/app/index.html in place and is safe to re-run: earlier
// injections are replaced, so the skin can change without rebuilding VIA.
//   - same-origin Content-Security-Policy (see scripts/security.mjs)
//   - site favicon, theme-color and saved light/dark choice before first paint
//   - the site header bar, the shared tokens and the VIA skin
//
//   node scripts/via/inject.mjs site/via/app/index.html
import { readFileSync, writeFileSync } from 'node:fs';
import { VIA_CSP } from '../security.mjs';
import { icon } from '../../site/assets/icons.js';
import { SITE } from '../../site/assets/tools.js';

const file = process.argv[2];
if (!file) throw new Error('usage: node inject.mjs <index.html>');
let html = readFileSync(file, 'utf8');

const block = (name, body) => `<!-- hlt:${name} -->${body}<!-- /hlt:${name} -->`;
html = html.replace(/<!-- hlt:(\w+) -->[\s\S]*?<!-- \/hlt:\1 -->/g, '');

const head = [
  `<meta http-equiv="Content-Security-Policy" content="${VIA_CSP}">`,
  '<meta name="referrer" content="no-referrer">',
  '<meta name="theme-color" content="#f5f4ef" media="(prefers-color-scheme: light)">',
  '<meta name="theme-color" content="#111210" media="(prefers-color-scheme: dark)">',
  '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
  '<script src="/assets/theme-init.js"></script>',
].join('');
// After VIA's own stylesheet, so the skin's equal-specificity rules win.
const tail = [
  '<link rel="stylesheet" href="/assets/tokens.css">',
  '<link rel="stylesheet" href="/via/skin.css">',
  '<script type="module" src="/via/frame.js"></script>',
].join('');
const bar = `
<header class="hlt-bar">
  <a class="hlt-brand" href="/" aria-label="${SITE.name} home"><span class="hlt-mark">${icon('logo')}</span><span class="hlt-name">${SITE.name}</span></a>
  <span class="hlt-sep" aria-hidden="true">/</span>
  <span class="hlt-title">VIA <span class="hlt-title-long">Keyboard Configurator</span></span>
  <nav class="hlt-actions">
    <a class="hlt-link" href="/via/">${icon('help')}<span>Help</span></a>
    <button class="hlt-icon" type="button" data-theme-toggle></button>
  </nav>
</header>`;

const charset = /<meta charset="utf-8"\s*\/?>/i;
for (const [re, what] of [[charset, 'charset meta'], [/<\/head>/i, '</head>'], [/<body>/i, '<body>']]) {
  if (!re.test(html)) throw new Error(`${file}: ${what} not found`);
}
if (/Content-Security-Policy/.test(html)) throw new Error(`${file}: has a CSP outside the hlt blocks`);
html = html
  .replace(charset, (m) => m + block('head', head))
  .replace(/<\/head>/i, (m) => block('tail', tail) + m)
  .replace(/<body>/i, (m) => m + block('bar', bar));
writeFileSync(file, html);
console.log('injected Homelab Tools chrome into', file);
