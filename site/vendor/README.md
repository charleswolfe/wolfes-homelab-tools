# Vendored third-party code

Copied into the repo so the site has no runtime dependencies and works on a
machine with no internet connection. Do not edit these files except to strip
tracking or network code; replace them wholesale when upgrading.

| Library | Version | License | Source file | Used by | Audit notes |
|---|---|---|---|---|---|
| js-yaml | 4.1.0 | MIT | `dist/js-yaml.mjs` from the npm package | JSON ↔ YAML | No network calls, no `eval`, no telemetry. URLs appear only in comments. |
| @noble/secp256k1 | 3.2.0 | MIT | `index.js` from the npm package (single file, zero dependencies, audited) | Bitcoin paper wallet | No network calls, no `eval`, no telemetry; `import` statements appear only in doc comments. Randomness from `crypto.getRandomValues`. |
| VIA (the-via/app + the-via/keyboards) | app `935106a`, keyboards `904b42c` | GPL-3.0 (VIA); SIL OFL 1.1 (Fira Sans fonts); Apache-2.0 (Draco decoder, from three.js) | Built from source by `scripts/via/build.sh` into `site/via/app/` (not this folder) | VIA Keyboard Configurator | Patched by `scripts/via/patch.mjs`: Google Fonts → self-hosted Fira Sans; Draco decoder served locally instead of gstatic.com; outbound links (Discord, GitHub, caniuse, QMK docs) removed; `eval` regex workarounds replaced with literals; commercial Gotham Rounded and unused Symbola fonts dropped. App-install manifest and icons removed; Light Mode switch removed (the site theme applies) and a site-coloured keycap theme made the default. `scripts/via/inject.mjs` then adds the CSP, the site header bar and `site/via/skin.css`. The GitHub Gist feature is dead code upstream and absent from the bundle. No analytics found. Remaining URL strings are allow-listed in `test/offline.test.js` with reasons. |

## Rules for adding a library

1. **Nothing may contact another origin.** No CDNs, web fonts, analytics,
   error reporting, update checks or remote definitions. Assume the host is
   offline and that any outbound request would be flagged.
2. **Strip all trackers and telemetry** (Google Analytics/gtag, Sentry,
   Segment, Plausible, PostHog, etc.) before committing, including dormant
   code paths that are disabled by default.
3. Record the version, license, exact source file and what was removed in the
   table above, and keep the library's LICENSE file next to it.
4. `npm test` must pass: `test/offline.test.js` scans every file under
   `site/` (vendored code included) for external URLs in HTML/CSS, network
   APIs, remote imports and known tracker signatures. Every page also ships a
   `connect-src 'self'` Content-Security-Policy, so the browser blocks any
   request that slips through.
