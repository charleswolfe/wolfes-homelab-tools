# syntax=docker/dockerfile:1
#
# Homelab Tools: the static site, pre-compressed and served by
# static-web-server from a scratch image.
#
#   docker build -t homelab-tools .
#   docker build -t homelab-tools --build-arg SITE_URL=https://tools.lan .
#
# .dockerignore limits the build context to package.json, scripts/, site/ and
# docker/. Tests aren't part of the image: run `npm test` first (CI does).
#
# Base images are pinned by digest so a rebuild can't silently pick up a
# changed image; Dependabot (.github/dependabot.yml) proposes updates. The
# busybox reference appears twice; keep both the same.

# ---------- target-platform binaries ----------
FROM busybox:1.37.0-musl@sha256:8fddc201ee902ceabe7f766612d597201b70592e95451c9410f446440ef4786f AS busybox
FROM joseluisq/static-web-server:2.44.1@sha256:94618e3d17802265a21926217e6f9e7832b311b6fbf5933684001739fafed06a AS sws

# ---------- build-platform stages (output is the same for every platform) ----------
# Only the busybox applets the entrypoint and health check use, as symlinks.
# Made here rather than with RUN in the final stage, so multi-platform builds
# need no CPU emulation.
FROM --platform=$BUILDPLATFORM busybox:1.37.0-musl@sha256:8fddc201ee902ceabe7f766612d597201b70592e95451c9410f446440ef4786f AS applets
RUN mkdir /applets && for a in sh cat find grep id ls nc sed tr wget; do ln -s busybox "/applets/$a"; done

# Pre-compress site/ (brotli + gzip), write sitemap, headers and build.env.
FROM --platform=$BUILDPLATFORM node:26.12.1-alpine3.24@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS build
WORKDIR /app
COPY . .
ARG SITE_URL=http://localhost:8080
RUN node scripts/build.mjs --out /dist --site-url "$SITE_URL"

# ---------- runtime ----------
# Filesystem layers that rarely change come first; the site comes last, so
# editing site/ only rebuilds the final layers.
FROM scratch
COPY --from=busybox /bin/busybox /bin/busybox
COPY --from=applets /applets/ /bin/
COPY --from=sws /static-web-server /usr/local/bin/static-web-server
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/entrypoint
COPY --from=build /dist/etc /etc/homelab-tools
# Everything is owned by root and read-only to the server, except the two
# files SITE_URL may rewrite at start.
COPY --from=build /dist/site /srv
COPY --from=build --chown=10001:10001 /dist/site/sitemap.xml /dist/site/robots.txt /srv/

LABEL org.opencontainers.image.title="Homelab Tools" \
      org.opencontainers.image.description="Offline, private browser utilities for the homelab, served by static-web-server" \
      org.opencontainers.image.source="https://github.com/charleswolfe/wolfes-homelab-tools" \
      org.opencontainers.image.licenses="LicenseRef-MIT-Commons-Clause AND GPL-3.0-only"
USER 10001:10001
EXPOSE 8080 8443
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD ["/usr/local/bin/entrypoint", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/entrypoint"]
