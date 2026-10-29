# Development

Requires Node 20+ (no npm install needed) and Python 3 for the dev server.

```sh
npm test         # unit tests + offline/no-tracker guard
npm run dev      # serve site/ at http://localhost:8080
npm run build    # production build into dist/
```

- `site/assets/tools.js` is the tool registry; the index, menus, search and sitemap are generated from it.
- Tool logic lives in `site/lib/` as pure functions with tests in `test/`.
- Third-party code is copied into `site/vendor/`; read `site/vendor/README.md` before adding any.
- **VIA** is prebuilt into `site/via/app/` from the official source at a pinned commit, with patches that make it offline-only (see `site/vendor/README.md`). To update or rebuild it (needs Docker and internet access; VIA's npm install and build run inside a throwaway container, never on the host):
  ```sh
  sh scripts/via/build.sh    # edit VIA_COMMIT in the script to move to a newer release
  npm test                   # the offline/no-tracker check must still pass
  ```
- **VIA's look** comes from `site/via/skin.css`, which maps VIA's colour variables onto the site tokens (`site/assets/tokens.css`) and styles the header bar. Edit it freely; no rebuild needed. The header markup is written into `site/via/app/index.html` by `node scripts/via/inject.mjs site/via/app/index.html`, which is safe to re-run.

Run `npm test` before building an image or committing: the Docker build doesn’t run it. It covers the tool logic and the offline guard, which fails if any file references an outside host or contains known tracker code.
