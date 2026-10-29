# HTTPS

Some tools need a secure page:

| Tool | Over plain HTTP |
|---|---|
| VIA Keyboard Configurator | **Does not work.** Browsers only expose WebHID (keyboard access) on HTTPS, and only in Chromium-based browsers (Chrome, Edge, Brave, Opera). All 3,348 keyboard definitions are bundled, so it works with no internet access. |
| Bitcoin Paper Wallet | Works, but not recommended: anyone on the network path could alter the page before it generates keys. |

`localhost` counts as secure, so these tools also work when you browse on the Docker host itself.

There are three ways to get HTTPS. Options 1 and 2 use the container's built-in TLS; option 3 keeps the container on plain HTTP behind a proxy you already run.

## Option 1: mount certificate files

Put a PEM certificate (full chain) and its private key in a folder on the host and mount it read-only:

```sh
docker run -d --name homelab-tools --restart unless-stopped \
  -p 443:443 -p 80:80 --memory 56m \
  -v /opt/homelab-tools/certs:/certs:ro \
  -e TLS_CERT_FILE=/certs/fullchain.pem \
  -e TLS_KEY_FILE=/certs/privkey.pem \
  -e HTTPS_PORT=443 -e HTTP_PORT=80 \
  -e HOSTNAMES=tools.lan,192.168.1.20 \
  homelab-tools
```

- `HOSTNAMES` lists every name or IP people type to reach the site. Plain-HTTP requests to those names are redirected to `https://<first name>`, and requests for any other name get `400 Bad Request`. Leave it unset to serve HTTPS only.
- **Map the same port on both sides** (`443:443`, or `8443:8443` with `HTTPS_PORT=8443`). Redirects point at the container's HTTPS port, so it must be the port browsers use. Ports below 1024 work without root on Docker 20.10+.
- The container runs as uid/gid `10001`, so the key must be readable by it. See [Troubleshooting](troubleshooting.md#key-not-readable).
- After renewing a certificate, restart the container: `docker restart homelab-tools`.

## Option 2: Docker Compose secrets

Same files, but Docker mounts them under `/run/secrets/` and they never appear in environment variables or `docker inspect`. Point the same two variables at the secret paths:

```yaml
secrets:
  tls_cert:
    file: /opt/homelab-tools/certs/fullchain.pem
  tls_key:
    file: /opt/homelab-tools/certs/privkey.pem

services:
  homelab-tools:
    image: homelab-tools
    secrets: [tls_cert, tls_key]
    environment:
      TLS_CERT_FILE: /run/secrets/tls_cert
      TLS_KEY_FILE: /run/secrets/tls_key
```

The full compose example is in [Docker Compose](docker-compose.md).

## Option 3: behind your reverse proxy

If you already run Caddy, Traefik, Nginx Proxy Manager or similar, don't set any TLS variables. The container serves plain HTTP on port 8080 and the proxy handles certificates. The HTTPS banners check the address in the browser, so they disappear automatically once users reach the site through the proxy.

<details>
<summary>Caddy</summary>

```caddy
tools.lan {
    tls /etc/caddy/certs/tools.lan.pem /etc/caddy/certs/tools.lan-key.pem
    reverse_proxy homelab-tools:8080
}
```
</details>

<details>
<summary>Traefik (container labels)</summary>

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.tools.rule=Host(`tools.lan`)
  - traefik.http.routers.tools.entrypoints=websecure
  - traefik.http.routers.tools.tls=true
  - traefik.http.services.tools.loadbalancer.server.port=8080
```
</details>

<details>
<summary>Nginx Proxy Manager</summary>

Add a Proxy Host: domain `tools.lan`, scheme `http`, forward hostname `homelab-tools` (or the host IP), port `8080`, then choose your certificate on the SSL tab and enable "Force SSL".
</details>

## Getting a certificate without internet access

Let's Encrypt's default HTTP check needs your server reachable from the internet, so for an offline LAN use one of these:

- **Your own certificate authority in Docker (step-ca).** Fully offline and renews itself. Follow [Generate certificates with step-ca](step-ca.md).
- **mkcert** on a workstation, for a quick one-off. Install its root on your devices with `mkcert -install`, then:
  ```sh
  mkcert -cert-file fullchain.pem -key-file privkey.pem tools.home.arpa 192.168.1.20
  ```
  and copy both files into `/opt/homelab-tools/certs/`.
- **Let's Encrypt via DNS-01** on an internet-connected machine (for a real domain you own), then copy `fullchain.pem` and `privkey.pem` over.

Plain self-signed certificates show a warning on every visit, and browsers may not unlock WebHID for VIA. Prefer a local CA.
