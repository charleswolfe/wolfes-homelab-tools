#!/bin/sh
# Container entrypoint (busybox sh). Translates the documented environment
# variables into static-web-server settings, validates TLS files, warms the
# page cache and starts the server.
#
#   entrypoint            start the server (default)
#   entrypoint info       print configuration and memory recommendation
#   entrypoint healthcheck
set -eu

. /etc/homelab-tools/build.env

HTTP_PORT="${HTTP_PORT:-8080}"
HTTPS_PORT="${HTTPS_PORT:-8443}"
TLS_CERT_FILE="${TLS_CERT_FILE:-}"
TLS_KEY_FILE="${TLS_KEY_FILE:-}"
HOSTNAMES="$(echo "${HOSTNAMES:-}" | tr -d ' ')"
HTTPS_REDIRECT="${HTTPS_REDIRECT:-auto}"
HSTS="${HSTS:-false}"
SITE_URL="${SITE_URL:-}"
LOG_LEVEL="${LOG_LEVEL:-warn}"
ROOT=/srv
ETC=/etc/homelab-tools

log() { echo "[homelab-tools] $*"; }
warn() { echo "[homelab-tools] WARNING: $*" >&2; }
die() { echo "[homelab-tools] ERROR: $*" >&2; exit 1; }
is_true() { case "$(echo "$1" | tr 'A-Z' 'a-z')" in 1|true|yes|on) return 0 ;; *) return 1 ;; esac; }
mib() { echo $(( ($1 + 1048575) / 1048576 )); }
human() { if [ "$1" -ge 1048576 ]; then echo "$(( ($1 + 524288) / 1048576 )) MiB"; else echo "$(( ($1 + 512) / 1024 )) KiB"; fi; }
tls_on() { [ -n "$TLS_CERT_FILE" ] || [ -n "$TLS_KEY_FILE" ]; }

check_file() { # VAR_NAME path
  [ -e "$2" ] || die "$1=$2 does not exist inside the container. Check the volume mount (or secret name) and the path."
  [ -r "$2" ] || die "$1=$2 exists but the container user (uid $(id -u), gid $(id -g)) cannot read it.
  Fix on the host:   sudo chgrp $(id -g) <file> && sudo chmod 640 <file>
  or run the container as root (compose: user: \"0:0\")."
  [ -s "$2" ] || die "$1=$2 is empty."
}

case "${1:-serve}" in
  healthcheck)
    if tls_on; then
      # busybox's TLS client can't handshake with static-web-server (rustls),
      # so in HTTPS mode check that the listener accepts connections.
      exec nc -w 3 127.0.0.1 "$HTTPS_PORT" < /dev/null
    fi
    exec wget -q -T 3 --spider "http://127.0.0.1:${HTTP_PORT}/health"
    ;;
  info)
    echo "Homelab Tools (built ${BUILD_DATE})"
    echo "  served files:        $(human "$ASSET_BYTES") (JS + HTML $(human "$JS_HTML_BYTES"))"
    echo "  memory-cache budget: $(human "$CACHE_BUDGET_BYTES")"
    echo "  recommended limit:   ${MEM_LIMIT_MIB}m   (docker run --memory ${MEM_LIMIT_MIB}m / compose mem_limit: ${MEM_LIMIT_MIB}m)"
    exit 0
    ;;
  serve) ;;
  *) exec "$@" ;;
esac

export SERVER_ROOT="$ROOT"
export SERVER_LOG_LEVEL="$LOG_LEVEL"
export SERVER_HEALTH=true
export SERVER_COMPRESSION=false           # assets are pre-compressed at build time
export SERVER_COMPRESSION_STATIC=true
export SERVER_SECURITY_HEADERS=false      # our own headers come from the config file
export SERVER_CACHE_CONTROL_HEADERS=false
export SERVER_DIRECTORY_LISTING=false
export SERVER_IGNORE_HIDDEN_FILES=true
export SERVER_PAGE404="$ROOT/404.html"

if tls_on; then
  [ -n "$TLS_CERT_FILE" ] && [ -n "$TLS_KEY_FILE" ] || die "Set both TLS_CERT_FILE and TLS_KEY_FILE, or neither."
  check_file TLS_CERT_FILE "$TLS_CERT_FILE"
  check_file TLS_KEY_FILE "$TLS_KEY_FILE"
  grep -q 'BEGIN CERTIFICATE' "$TLS_CERT_FILE" || die "TLS_CERT_FILE=$TLS_CERT_FILE is not a PEM certificate (no 'BEGIN CERTIFICATE' line)."
  grep -q 'PRIVATE KEY' "$TLS_KEY_FILE" || die "TLS_KEY_FILE=$TLS_KEY_FILE is not a PEM private key (no 'PRIVATE KEY' line)."
  grep -q 'BEGIN CERTIFICATE' "$TLS_KEY_FILE" && ! grep -q 'PRIVATE KEY' "$TLS_KEY_FILE" && die "TLS_KEY_FILE contains a certificate, not a key. Are the two paths swapped?"

  export SERVER_PORT="$HTTPS_PORT"
  export SERVER_HTTP2_TLS=true
  export SERVER_HTTP2_TLS_CERT="$TLS_CERT_FILE"
  export SERVER_HTTP2_TLS_KEY="$TLS_KEY_FILE"
  if is_true "$HSTS"; then export SERVER_CONFIG_FILE="$ETC/sws-https-hsts.toml"; else export SERVER_CONFIG_FILE="$ETC/sws-https.toml"; fi

  case "$(echo "$HTTPS_REDIRECT" | tr 'A-Z' 'a-z')" in
    auto) if [ -n "$HOSTNAMES" ]; then redirect=1; else redirect=0; fi ;;
    1|true|yes|on) [ -n "$HOSTNAMES" ] || die "HTTPS_REDIRECT=true needs HOSTNAMES, the names/IPs people type (e.g. HOSTNAMES=tools.lan,192.168.1.20)."; redirect=1 ;;
    *) redirect=0 ;;
  esac
  if [ "$redirect" = 1 ]; then
    export SERVER_HTTPS_REDIRECT=true
    export SERVER_HTTPS_REDIRECT_FROM_PORT="$HTTP_PORT"
    export SERVER_HTTPS_REDIRECT_HOST="${HOSTNAMES%%,*}"
    export SERVER_HTTPS_REDIRECT_FROM_HOSTS="$HOSTNAMES"
    log "HTTPS on :${HTTPS_PORT}; plain HTTP on :${HTTP_PORT} redirects to https://${HOSTNAMES%%,*}:${HTTPS_PORT}"
  else
    [ -n "$HOSTNAMES" ] || warn "HOSTNAMES is not set, so plain HTTP (:${HTTP_PORT}) is not served or redirected. Set HOSTNAMES to enable the redirect."
    log "HTTPS on :${HTTPS_PORT}"
  fi
  if [ "$HTTPS_PORT" != 443 ] && [ "$redirect" = 1 ]; then
    log "Map the same port on the host (ports: \"${HTTPS_PORT}:${HTTPS_PORT}\"); redirects point at :${HTTPS_PORT}."
  fi
  scheme=https
else
  is_true "$HSTS" && warn "HSTS=true has no effect without TLS_CERT_FILE/TLS_KEY_FILE."
  export SERVER_PORT="$HTTP_PORT"
  export SERVER_CONFIG_FILE="$ETC/sws-http.toml"
  log "HTTP on :${HTTP_PORT} (no TLS configured; put a TLS reverse proxy in front for HTTPS-only tools)"
  scheme=http
fi

# Absolute URLs in sitemap.xml / robots.txt.
if [ -n "$SITE_URL" ] && [ "$SITE_URL" != "$BUILD_SITE_URL" ]; then
  url="${SITE_URL%/}"
  # busybox's [ -w ] ignores read-only mounts, so just try the write.
  if sed -i "s#${BUILD_SITE_URL}#${url}#g" "$ROOT/sitemap.xml" "$ROOT/robots.txt" 2>/dev/null; then
    BUILD_SITE_URL="$url"
  else
    warn "SITE_URL is set but $ROOT is read-only; sitemap.xml keeps ${BUILD_SITE_URL}."
  fi
fi

# Memory: warm the page cache with every served file, and compare the
# container limit with the recommendation.
find "$ROOT" -type f -exec cat {} + > /dev/null 2>&1 || true
limit="$(cat /sys/fs/cgroup/memory.max 2>/dev/null || echo max)"
if [ "$limit" != max ] && [ "$limit" -lt $((MEM_LIMIT_MIB * 1048576)) ] 2>/dev/null; then
  warn "memory limit is $(mib "$limit") MiB; ${MEM_LIMIT_MIB} MiB is recommended so the whole site stays cached."
fi
log "site $(human "$ASSET_BYTES"), cache budget $(human "$CACHE_BUDGET_BYTES"), recommended memory limit ${MEM_LIMIT_MIB}m; sitemap base ${BUILD_SITE_URL} (${scheme})"

exec /usr/local/bin/static-web-server
