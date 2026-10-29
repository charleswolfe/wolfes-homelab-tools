# Troubleshooting

<a id="key-not-readable"></a>
**`ERROR: TLS_KEY_FILE=... exists but the container user (uid 10001, gid 10001) cannot read it`**
Private keys are usually `600 root`. Either give the container's group read access:
```sh
sudo chgrp 10001 /opt/homelab-tools/certs/privkey.pem
sudo chmod 640  /opt/homelab-tools/certs/privkey.pem
```
or run the container as root (`user: "0:0"` in compose, `--user 0:0` with `docker run`).

**`does not exist inside the container`**: the volume or secret isn't mounted where the variable points. Check `docker inspect homelab-tools` → Mounts.

**`is not a PEM certificate` / `contains a certificate, not a key`**: the two paths are swapped, or the file is DER. Convert with `openssl x509 -in cert.der -inform der -out fullchain.pem`.

**HTTP gives `400 Bad Request` with TLS enabled**: the name in the address bar isn't listed in `HOSTNAMES`.

**Redirect goes to the wrong port**: host and container HTTPS ports differ. Use the same number on both sides.

**VIA shows "This tool needs a secure (HTTPS) connection"**: you're on plain HTTP. Set up one of the [HTTPS options](https.md), or browse from the Docker host via `localhost`.
