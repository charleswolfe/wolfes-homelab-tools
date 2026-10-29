# Portainer

If the Docker host has internet access, Portainer pulls the published image itself. Otherwise import it first under **Images → Import** (see [Hosts without internet access](install.md#hosts-without-internet-access)).

## As a stack (recommended; supports all three options)

1. **Stacks → Add stack**, name it `homelab-tools`, choose **Web editor**.
2. Paste one of the [compose examples](docker-compose.md).
3. Use **absolute host paths** for certificates and secrets (`/opt/homelab-tools/certs/...`). Portainer runs compose from its own data directory, so `./certs` won't point where you expect.
4. Optionally move values into the **Environment variables** section below the editor and reference them in the YAML, e.g. `HOSTNAMES: ${HOSTNAMES}`.
5. **Deploy the stack**, then open the container's **Logs** to check the startup summary.

## As a single container (options 1 and 3)

**Containers → Add container**:

| Field | Value |
|---|---|
| Image | `ghcr.io/charleswolfe/wolfes-homelab-tools:latest` (turn off "Always pull the image" on an offline host) |
| Network ports | host `8080` → container `8080`; for HTTPS use `443` → `443` and `80` → `80` |
| Volumes (HTTPS) | **Bind**, host `/opt/homelab-tools/certs` → container `/certs`, **Read-only** |
| Env (HTTPS) | `TLS_CERT_FILE=/certs/fullchain.pem`, `TLS_KEY_FILE=/certs/privkey.pem`, `HTTPS_PORT=443`, `HTTP_PORT=80`, `HOSTNAMES=tools.lan,192.168.1.20` |
| Restart policy | Unless stopped |
| Runtime & Resources | Memory limit `56` MB |

Docker secrets (option 2) aren't available in Portainer's single-container form on a standalone Docker host. Use a stack for that.
