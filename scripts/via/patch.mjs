// Patches applied to the-via/app before building, so the vendored copy:
//   - runs from /via/app/ instead of the site root,
//   - never contacts another host (Google Fonts, GitHub, Discord, caniuse…),
//   - ships only redistributable fonts (Gotham Rounded is commercial),
//   - drops unused files.
// Each replacement must match exactly once, so upstream changes fail loudly
// instead of silently producing an unpatched build.
//
// Usage (inside the build container): node patch.mjs <via-app-dir>
import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync, cpSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('usage: node patch.mjs <via-app-dir>');

function patch(file, pairs) {
  const p = join(dir, file);
  let s = readFileSync(p, 'utf8');
  for (const [from, to] of pairs) {
    const count = s.split(from).length - 1;
    if (count !== 1) throw new Error(`${file}: expected exactly one match for ${JSON.stringify(from.slice(0, 80))}, found ${count}`);
    s = s.replace(from, to);
  }
  writeFileSync(p, s);
  console.log(`patched ${file} (${pairs.length})`);
}

// 1. Definitions load relative to wherever the app is served.
patch('src/utils/device-store.ts', [
  ["fetch('/definitions/supported_kbs.json'", "fetch(`${import.meta.env.BASE_URL}definitions/supported_kbs.json`"],
  ['const url = `/definitions/${version}/${vpid}.json`;', 'const url = `${import.meta.env.BASE_URL}definitions/${version}/${vpid}.json`;'],
]);

// 2. index.html: no Google Fonts, no social-card or app-install metadata (the
// site favicon and theme colours are added by inject.mjs after the build).
patch('index.html', [
  ['  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">\n'
    + '  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">\n'
    + '  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">\n'
    + '  <link rel="manifest" href="/site.webmanifest">\n'
    + '  <link rel="mask-icon" href="/safari-pinned-tab.svg" color="#5bbad5">\n'
    + '  <meta name="msapplication-TileColor" content="#da532c">\n'
    + '  <meta name="theme-color" content="#dadada">\n', ''],
  ['  <meta name="description" content="Your keyboard\'s best friend" />\n'
    + '  <meta data-react-helmet="true" property="og:image" content="/android-chrome-512x512.png">\n'
    + '  <meta data-react-helmet="true" property="twitter:image" content="https://usevia.app/images/chippy.png">\n'
    + '  <meta data-react-helmet="true" http-equiv="x-ua-compatible" content="ie=edge">\n'
    + '  <meta data-react-helmet="true" property="og:title" content="VIA">\n'
    + '  <meta data-react-helmet="true" name="description" content="Your keyboard&#x27;s best friend">\n'
    + '  <meta data-react-helmet="true" property="og:description" content="Your keyboard&#x27;s best friend">\n'
    + '  <meta data-react-helmet="true" name="twitter:card" content="summary">\n',
    '  <meta name="description" content="Remap VIA-enabled QMK keyboards in the browser.">\n'],
  ['  <link rel="preconnect" href="https://fonts.googleapis.com">\n', ''],
  ['  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n', ''],
  ['  <link\n    href="https://fonts.googleapis.com/css2?family=Fira+Sans+Condensed:wght@300;400;500&family=Fira+Sans:wght@300;400&display=swap"\n    rel="stylesheet">\n',
    '  <link rel="stylesheet" href="local-fonts/fonts.css">\n'],
  ['<title>VIA</title>', '<title>VIA Keyboard Configurator · Homelab Tools</title>'],
]);

// 3. Global CSS: drop Google Fonts imports and the commercial/unused font faces.
patch('src/app.global.css', [
  ["@import url('https://fonts.googleapis.com/css?family=Fira+Sans');\n", ''],
  ["@import url('https://fonts.googleapis.com/css?family=Fira+Sans&text=%E2%86%90|%E2%86%92');\n", ''],
  ['@font-face {\n  font-family: GothamRoundedBold;\n  src: url(/fonts/GothamRoundedBold_21016.ttf) format(\'opentype\');\n}\n', ''],
  ['@font-face {\n  font-family: GothamRounded;\n  src: url(/fonts/GothamRoundedBook_21018.ttf) format(\'opentype\');\n}\n', ''],
  ['@font-face {\n  font-family: Symbola;\n  src: url(/fonts/Symbola.ttf) format(\'opentype\');\n}\n', ''],
]);
patch('src/components/panes/configure-panes/custom/satisfaction75/menu.tsx', [
  ['font-family: GothamRounded;', "font-family: 'Fira Sans', system-ui, sans-serif;"],
]);

// 4. Outbound links become plain text or disappear.
patch('src/components/menus/external-links.tsx', [
  ['export const ExternalLinks = () => (', 'export const ExternalLinks = () => null;\nconst _UpstreamExternalLinks = () => ('],
]);
patch('src/components/Home.tsx', [
  ['          <UsbErrorWebHIDLink\n            href="https://caniuse.com/?search=webhid"\n            target="_blank"\n          >\n            browsers that have WebHID enabled\n          </UsbErrorWebHIDLink>',
    '          <strong>browsers that have WebHID enabled</strong> (Chrome, Edge, Opera, Brave and other Chromium browsers)'],
]);
patch('src/components/panes/configure-panes/submenus/macros/script-mode.tsx', [
  ['<Link href="https://docs.qmk.fm/#/keycodes_basic" target="_blank">\n              {t(\'Basic Keycodes\')}\n            </Link>',
    "<strong>{t('Basic Keycodes')}</strong>"],
]);

// 5. No eval: upstream builds two regexes with eval() in case the browser
// lacks lookbehind support. Every browser with WebHID has it, and plain
// literals let the page run without 'unsafe-eval'.
for (const f of ['src/utils/macro-api/macro-api.ts', 'src/utils/macro-api/macro-api.v11.ts']) {
  patch(f, [
    ["eval('/(?<!\\\\\\\\){(?![^{]*})/')", '/(?<!\\\\){(?![^{]*})/'],
    ["eval('/(?<!\\\\\\\\){(.*?)}/g')", '/(?<!\\\\){(.*?)}/g'],
  ]);
}
patch('src/utils/macro-api/macro-api.common.ts', [
  ["eval('/(?<!\\\\\\\\)({.*?})/g')", '/(?<!\\\\)({.*?})/g'],
]);

// 6. The 3D keyboard model is Draco-compressed. drei would download the
// decoder from www.gstatic.com; serve three's bundled copy instead.
const DRACO = '`${import.meta.env.BASE_URL}draco/`';
patch('src/components/three-fiber/key-group.tsx', [
  ['useGLTF(glbSrc, true).scene', `useGLTF(glbSrc, ${DRACO}).scene`],
]);
patch('src/components/three-fiber/canvas-router.tsx', [
  ['useGLTF.preload(cubeySrc, true, true);', `useGLTF.preload(cubeySrc, ${DRACO}, true);`],
  ['useGLTF.preload(glbSrc, true, true);', `useGLTF.preload(glbSrc, ${DRACO}, true);`],
  ['useGLTF(glbSrc, true, true);', `useGLTF(glbSrc, ${DRACO}, true);`],
]);
const dracoSrc = join(dir, 'node_modules/three/examples/jsm/libs/draco/gltf');
mkdirSync(join(dir, 'public/draco'), { recursive: true });
for (const f of ['draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js']) {
  cpSync(join(dracoSrc, f), join(dir, 'public/draco', f));
}
console.log('bundled Draco decoder');

// 7. Theme: light/dark follows the site's own toggle (header bar, see
// site/via/skin.css), so VIA's separate Light Mode switch goes. New users get
// the GAMER keycap theme (black caps, RGB backlight; effects in skin.css).
// HOMELAB is a retro platinum look after Apple's Extended Keyboard II; any
// keycap theme can still be picked. Themes may also set
// their own case colours (upstream always paints the case in the accent-key
// colour, which would make a beige case swallow beige accent keys).
patch('src/components/panes/settings.tsx', [
  ["            <ControlRow>\n              <Label>{t('Light Mode')}</Label>\n              <Detail>\n                <AccentSlider\n                  onChange={() => dispatch(toggleThemeMode())}\n                  isChecked={themeMode === 'light'}\n                />\n              </Detail>\n            </ControlRow>\n", ''],
]);
patch('src/utils/themes.ts', [
  ['  accent: KeyColorPair;\n};', '  accent: KeyColorPair;\n  case?: {outer: string; well: string};\n  fx?: string;\n};'],
  ['  ...{\n    OLIVIA_DARK: {', "  ...{\n    HOMELAB: {\n      alpha: {c: '#ece8dc', t: '#46433c'},\n      mod: {c: '#cdc6b5', t: '#46433c'},\n      accent: {c: '#b5ae9c', t: '#2b2924'},\n      case: {outer: '#dcd6c8', well: 'linear-gradient(180deg, #a49e8e, #8f897a)'},\n    },\n    GAMER: {\n      alpha: {c: '#1d1f1b', t: '#5effd6'},\n      mod: {c: '#171916', t: '#5effd6'},\n      accent: {c: '#262922', t: '#5effd6'},\n      case: {outer: '#121411', well: '#070806'},\n      fx: 'rgb',\n    },\n    OLIVIA_DARK: {"],
]);
// A saved theme always beats the default, so browsers that used VIA before
// would never see a new default. Apply each new site default once, recorded
// in hlt:via-theme-default; a theme picked after that is kept.
patch('src/utils/device-store.ts', [
  ["    themeName: 'OLIVIA_DARK',", "    themeName: 'GAMER',"],
  ['function initDeviceStore() {\n  deviceStore = new Store(defaultStoreData);\n}\n\ninitDeviceStore();\n',
    "function initDeviceStore() {\n  deviceStore = new Store(defaultStoreData);\n}\n\ninitDeviceStore();\n\nconst HLT_THEME_DEFAULT = defaultStoreData.settings.themeName;\ntry {\n  if (localStorage.getItem('hlt:via-theme-default') !== HLT_THEME_DEFAULT) {\n    deviceStore.set('settings', {...deviceStore.get('settings'), themeName: HLT_THEME_DEFAULT});\n    localStorage.setItem('hlt:via-theme-default', HLT_THEME_DEFAULT);\n  }\n} catch {\n  // storage unavailable: the default applies anyway\n}\n"],
]);
patch('src/components/two-string/case.tsx', [
  // A theme's fx (GAMER: 'rgb') tags the case wrapper; the keys are its
  // later siblings, so skin.css reaches them with .hlt-fx-rgb ~ * .hlt-cap.
  ['    <CaseGroup>', "    <CaseGroup\n      className={\n        (theme as {fx?: string}).fx ? `hlt-fx-${(theme as {fx?: string}).fx}` : undefined\n      }\n    >"],
  ['      <OuterCase\n', '      <OuterCase\n        className="hlt-case"\n'],
  ['      <InnerCase\n', '      <InnerCase\n        className="hlt-case-well"\n'],
  ['  const outsideColor = useMemo(() => theme[KeyColorType.Accent].c, [theme]);',
    '  const caseColors = (theme as {case?: {outer: string; well: string}}).case;\n  const outsideColor = useMemo(\n    () => caseColors?.outer ?? theme[KeyColorType.Accent].c,\n    [theme],\n  );'],
  ['        background={`linear-gradient(200deg,${stp1} 40%,${stp2},${stp3} 80%)`}',
    '        background={\n          caseColors?.well ??\n          `linear-gradient(200deg,${stp1} 40%,${stp2},${stp3} 80%)`\n        }'],
]);
// Class hooks so site/via/skin.css can shade the 2D keycaps like physical
// ones (sculpted top, skirt, shadow, press travel) over any theme's colours.
patch('src/components/two-string/unit-key/keycap.tsx', [
  ['        <GlowContainer\n          $selected={selected}\n',
    "        <GlowContainer\n          className={\n            pressedState === KeycapState.Pressed ? 'hlt-cap hlt-cap-down' : 'hlt-cap'\n          }\n          $selected={selected}\n"],
  ['            <TestOverlay\n              style={{\n                background: keycapColor,',
    '            <TestOverlay\n              className="hlt-cap-overlay"\n              style={{\n                background: keycapColor,'],
  ['          <CanvasContainer\n            style={{\n              borderRadius: 4,',
    '          <CanvasContainer\n            className="hlt-cap-top"\n            style={{\n              borderRadius: 4,'],
]);
// The grey-and-accent gradient behind the keyboard reads as a haze over it;
// skin.css replaces it through --via-keyboard-bg.
patch('src/components/two-string/canvas-router.tsx', [
  ['    `linear-gradient(30deg, rgba(150,150,150,1) 10%,${getDarkenedColor(\n      props.$color,\n    )} 50%, rgba(150,150,150,1) 90%)`};',
    '    `var(--via-keyboard-bg, linear-gradient(30deg, rgba(150,150,150,1) 10%,${getDarkenedColor(\n      props.$color,\n    )} 50%, rgba(150,150,150,1) 90%))`};'],
]);

// Routing: VIA expects to live at the site root (/settings, /test…). Hash
// routes (/via/app/#/settings) keep every tab under /via/app/ and survive a
// reload on a static server with no SPA fallback.
patch('src/Routes.tsx', [
  ["import {Route} from 'wouter';", "import {Route, Router} from 'wouter';"],
  ["import {useMemo, useState} from 'react';", "import {useEffect, useMemo, useState} from 'react';"],
  ["import styled from 'styled-components';\n", `import styled from 'styled-components';

const hashPath = () => window.location.hash.replace(/^#/, '') || '/';
const useHashLocation = (): [string, (to: string) => void] => {
  const [loc, setLoc] = useState(hashPath());
  useEffect(() => {
    const onChange = () => setLoc(hashPath());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return [loc, (to: string) => { window.location.hash = to; }];
};`],
  ['export default () => {\n  const hasHIDSupport', 'const AppRoutes = () => {\n  const hasHIDSupport'],
  ['    </>\n  );\n};\n', '    </>\n  );\n};\n\nexport default () => (\n  <Router hook={useHashLocation}>\n    <AppRoutes />\n  </Router>\n);\n'],
]);

// Tab icons: upstream colours inactive tabs with the keycap theme's "ink on
// accent" colour, which disappears on the site's backgrounds.
patch('src/components/panes/grid.tsx', [
  ['  position: relative;\n  color: var(--color_inside-accent);\n  height: 35px;',
    "  position: relative;\n  color: ${(props) =>\n    props.$selected ? 'var(--color_inside-accent)' : 'var(--color_label)'};\n  height: 35px;"],
]);

// 8. Files we don't ship: commercial fonts, unused font/images, GitHub OAuth page.
for (const f of [
  'public/fonts/GothamRounded-Bold.otf', 'public/fonts/GothamRounded-BoldItalic.otf', 'public/fonts/GothamRounded-Book.otf',
  'public/fonts/GothamRounded-BookItalic.otf', 'public/fonts/GothamRounded-Light.otf', 'public/fonts/GothamRounded-LightItalic.otf',
  'public/fonts/GothamRounded-Medium.otf', 'public/fonts/GothamRounded-MediumItalic.otf', 'public/fonts/GothamRoundedBold_21016.ttf',
  'public/fonts/GothamRoundedBook_21018.ttf', 'public/fonts/GothamRoundedLight_21020.ttf', 'public/fonts/GothamRoundedMedium_21022.ttf',
  'public/fonts/Symbola.ttf', 'public/images', 'public/github_oauth.html', 'public/assets/404.html',
  // App-install manifest and its icons: VIA here is a page, not an installable app.
  'public/site.webmanifest', 'public/browserconfig.xml', 'public/safari-pinned-tab.svg', 'public/favicon.ico',
  'public/favicon-16x16.png', 'public/favicon-32x32.png', 'public/apple-touch-icon.png',
  'public/android-chrome-192x192.png', 'public/android-chrome-512x512.png', 'public/robots.txt',
  'public/mstile-70x70.png', 'public/mstile-144x144.png', 'public/mstile-150x150.png', 'public/mstile-310x150.png', 'public/mstile-310x310.png',
]) {
  const p = join(dir, f);
  if (!existsSync(p)) throw new Error(`expected ${f} to exist upstream`);
  rmSync(p, { recursive: true });
}
console.log('removed unshipped files');

// 9. Self-hosted Fira Sans / Fira Sans Condensed (SIL OFL) from @fontsource.
const fontsOut = join(dir, 'public/local-fonts');
mkdirSync(fontsOut, { recursive: true });
const faces = [];
for (const [pkg, family, weights] of [
  ['@fontsource/fira-sans', 'Fira Sans', [300, 400]],
  ['@fontsource/fira-sans-condensed', 'Fira Sans Condensed', [300, 400, 500]],
]) {
  const src = join(dir, 'node_modules', pkg, 'files');
  const slug = pkg.split('/')[1];
  for (const subset of ['latin', 'latin-ext']) {
    for (const w of weights) {
      const file = `${slug}-${subset}-${w}-normal.woff2`;
      cpSync(join(src, file), join(fontsOut, file));
      faces.push(`@font-face{font-family:'${family}';font-style:normal;font-display:swap;font-weight:${w};src:url(./${file}) format('woff2');${subset === 'latin'
        ? 'unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
        : 'unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'}}`);
    }
  }
  cpSync(join(dir, 'node_modules', pkg, 'LICENSE'), join(fontsOut, `${slug}-LICENSE.txt`));
}
writeFileSync(join(fontsOut, 'fonts.css'), faces.join('\n') + '\n');
console.log(`self-hosted ${faces.length} font files`);
