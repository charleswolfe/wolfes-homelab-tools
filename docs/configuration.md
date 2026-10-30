# Configuration

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `TLS_CERT_FILE` | none | Path inside the container to the PEM certificate (full chain). Set together with `TLS_KEY_FILE` to enable HTTPS. |
| `TLS_KEY_FILE` | none | Path inside the container to the PEM private key. |
| `HOSTNAMES` | none | Comma-separated names/IPs used to reach the site. With TLS, enables the HTTP→HTTPS redirect to the first entry; other hosts get 400. |
| `HTTPS_PORT` | `8443` | Container HTTPS port. Map the same port on the host. |
| `HTTP_PORT` | `8080` | Container HTTP port (the site without TLS, or the redirect listener with TLS). |
| `HTTPS_REDIRECT` | `auto` | `auto` redirects when `HOSTNAMES` is set; `false` disables it; `true` requires `HOSTNAMES`. |
| `HSTS` | `false` | `true` sends `Strict-Transport-Security: max-age=31536000` (no preload). Only enable once HTTPS is permanent: browsers will then refuse plain HTTP for that name for a year. |
| `SITE_URL` | build arg | Base URL for `sitemap.xml` / `robots.txt`. Ignored with a warning on a read-only filesystem. |
| `LOG_LEVEL` | `warn` | `error`, `warn`, `info` (logs every request), `debug`, `trace`. |

Every response carries a same-origin Content-Security-Policy (the DNS Lookup and SPF & DMARC Checker pages' also let them connect to DNS-over-HTTPS resolvers), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: SAMEORIGIN` and a restrictive `Permissions-Policy`.

## Image security

- Runs as an unprivileged user (uid/gid `10001`) in a `scratch` image: no package manager and no libraries, just static-web-server and busybox.
- busybox provides only the 10 commands the startup script and health check use (`sh`, `cat`, `find`, `grep`, `id`, `ls`, `nc`, `sed`, `tr`, `wget`).
- The site files belong to root and are read-only to the server. The only exceptions are `sitemap.xml` and `robots.txt`, so `SITE_URL` can rewrite them at startup.
- Base images are pinned by digest. Published images come with an SBOM and build provenance.

## Memory and caching

The build measures every file the server can send (originals plus `.br`/`.gz`) and reserves that much memory for caching: 100% of the site, capped at 50 MB. It adds a 16 MiB server baseline and rounds up, which gives the recommended limit (currently **56m**). At startup the container reads every file once so the kernel page cache holds the whole site in RAM, and it logs a warning if the container's memory limit is lower than recommended.

Measured usage with the whole site cached: about 33 MiB.
