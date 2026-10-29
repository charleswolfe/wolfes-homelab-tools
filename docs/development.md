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

## CI and publishing the image

`.github/workflows/docker-publish.yml` runs on every push and pull request:

1. `npm test`.
2. Builds the image for `linux/amd64`, `linux/arm64` and `linux/arm/v7`, using the GitHub Actions build cache.
3. On `main` and on version tags only, pushes it to `ghcr.io/charleswolfe/wolfes-homelab-tools` with an SBOM and build provenance. Pull requests build but never publish.

### Releasing a version

1. Set `"version"` in `package.json` (for example `1.1.0`) and add a matching `## [1.1.0] - YYYY-MM-DD` section to the top of `CHANGELOG.md`. `npm test` fails if the two don't match.
2. Commit, then tag that commit and push the tag:

   ```sh
   git tag -a v1.1.0 -m "v1.1.0"
   git push origin main v1.1.0
   ```

The workflow then:

1. runs the tests, and stops if the tag doesn't match `package.json` or the changelog has no section for it;
2. publishes the image as `1.1.0`, `1.1` and `1`;
3. creates a GitHub release named `v1.1.0`, using that version's changelog section as the notes, plus the `docker pull` command.

`latest` follows `main`, not tags.

**After the first publish**, make the package public. GitHub always creates new packages as private, and pulls then fail with `denied`. Go to your profile → **Packages** → `wolfes-homelab-tools` → **Package settings** → **Change visibility** → **Public**. You only need to do this once; public images can be pulled without logging in. The workflow links the package to this repository automatically, so it shows up on the repo page and the workflow keeps permission to push to it.

Dependabot (`.github/dependabot.yml`) opens weekly pull requests when a base image or an action has a new version. Both are pinned to exact digests or commits, so nothing changes without a reviewed PR. The busybox image appears twice in the `Dockerfile`; keep both lines identical.
