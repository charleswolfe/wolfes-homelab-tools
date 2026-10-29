# Docker Compose

There's no compose file in this repo; copy whichever of these fits into your own `compose.yaml`.

**Plain HTTP / behind a reverse proxy (option 3):**

```yaml
services:
  homelab-tools:
    image: homelab-tools
    container_name: homelab-tools
    restart: unless-stopped
    ports:
      - "8080:8080"
    mem_limit: 56m
    read_only: true            # optional; the image needs no writable paths
```

**Built-in HTTPS with mounted files (option 1):**

```yaml
services:
  homelab-tools:
    image: homelab-tools
    container_name: homelab-tools
    restart: unless-stopped
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - /opt/homelab-tools/certs:/certs:ro
    environment:
      TLS_CERT_FILE: /certs/fullchain.pem
      TLS_KEY_FILE: /certs/privkey.pem
      HTTPS_PORT: "443"
      HTTP_PORT: "80"
      HOSTNAMES: tools.lan,192.168.1.20
      SITE_URL: https://tools.lan
      # HSTS: "true"           # opt in once HTTPS is permanent
    mem_limit: 56m
```

**Built-in HTTPS with secrets (option 2):**

```yaml
secrets:
  tls_cert:
    file: /opt/homelab-tools/certs/fullchain.pem
  tls_key:
    file: /opt/homelab-tools/certs/privkey.pem

services:
  homelab-tools:
    image: homelab-tools
    container_name: homelab-tools
    restart: unless-stopped
    ports:
      - "443:443"
      - "80:80"
    secrets: [tls_cert, tls_key]
    environment:
      TLS_CERT_FILE: /run/secrets/tls_cert
      TLS_KEY_FILE: /run/secrets/tls_key
      HTTPS_PORT: "443"
      HTTP_PORT: "80"
      HOSTNAMES: tools.lan,192.168.1.20
    mem_limit: 56m
```

Then `docker compose up -d`, and `docker compose logs homelab-tools` to see the startup summary. If you'd rather have Compose build the image, replace `image: homelab-tools` with `build: /path/to/wolfes-homelab-tools`.
