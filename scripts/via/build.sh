#!/bin/sh
# Rebuilds the vendored VIA app into site/via/app/.
#
# The-via/app is cloned at a pinned commit on the host (git only, nothing is
# executed), then installed, patched and built inside a throwaway Docker
# container so its third-party install scripts never run on the host.
# Requires: git, docker, and internet access (for the clone and npm).
#
#   sh scripts/via/build.sh
set -eu

VIA_REPO=https://github.com/the-via/app.git
VIA_COMMIT=935106a990af39bdd1ade881c02366eac486240d   # 2026-09-17
NODE_IMAGE=node:24.22.2-alpine3.24
FONTSOURCE="@fontsource/fira-sans@5.3.0 @fontsource/fira-sans-condensed@5.3.0"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> cloning the-via/app @ ${VIA_COMMIT}"
git init -q "$WORK/app"
git -C "$WORK/app" fetch -q --depth 1 "$VIA_REPO" "$VIA_COMMIT"
git -C "$WORK/app" checkout -q FETCH_HEAD
cp "$ROOT/scripts/via/patch.mjs" "$WORK/patch.mjs"

echo "==> installing, patching and building in ${NODE_IMAGE}"
docker run --rm -v "$WORK:/work" -w /work/app "$NODE_IMAGE" sh -euc "
  apk add --no-cache git >/dev/null
  npm ci --no-audit --no-fund --loglevel=error
  npm install --no-save --no-audit --no-fund --loglevel=error $FONTSOURCE
  node --import tsx node_modules/via-keyboards/scripts/build-all.ts public/definitions
  node /work/patch.mjs /work/app
  npx vite build --base=/via/app/ --logLevel warn
  chown -R $(id -u):$(id -g) /work/app/dist
"

echo "==> copying build to site/via/app"
rm -rf "$ROOT/site/via/app"
mkdir -p "$ROOT/site/via"
cp -R "$WORK/app/dist" "$ROOT/site/via/app"
cp "$WORK/app/LICENSE" "$ROOT/site/via/app/LICENSE.txt"
# Security policy, site header and skin links (see the script for details).
node "$ROOT/scripts/via/inject.mjs" "$ROOT/site/via/app/index.html"
KB_COMMIT=$(node -e "const l=require('$WORK/app/package-lock.json');const p=l.packages['node_modules/via-keyboards'];console.log((p.resolved||'').split('#')[1]||'unknown')")
printf 'the-via/app %s\nthe-via/keyboards %s\nbuilt %s\n' "$VIA_COMMIT" "$KB_COMMIT" "$(date -u +%Y-%m-%dT%H:%MZ)" > "$ROOT/site/via/app/VERSION.txt"
DEF_COUNT=$(find "$ROOT/site/via/app/definitions/v2" "$ROOT/site/via/app/definitions/v3" -name '*.json' | wc -l | tr -d ' ')
printf 'export const VIA_BUILD = { app: "%s", keyboards: "%s", definitions: %s, built: "%s" };\n' \
  "$VIA_COMMIT" "$KB_COMMIT" "$DEF_COUNT" "$(date -u +%Y-%m-%d)" > "$ROOT/site/via/app/build-info.js"
du -sh "$ROOT/site/via/app"
echo "done"
