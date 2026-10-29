# Generate certificates with step-ca

This runs a private certificate authority ([step-ca](https://smallstep.com/docs/step-ca/)) next to Homelab Tools. A one-shot `homelab-certs` service issues a one-year certificate straight into `/opt/homelab-tools/certs`, the same folder Homelab Tools mounts in every example in [HTTPS](https.md) and [Docker Compose](docker-compose.md). It saves the files as `fullchain.pem`, `privkey.pem` and `root_ca.crt`, and gives the key to the container's user (uid 10001). Homelab Tools waits until the certificate exists before it starts.

The examples use `home.arpa`, the name reserved for home networks (RFC 8375). Swap in your own names and IPs.

**1. Create the folders and the CA password**

```sh
sudo mkdir -p /opt/step-ca /opt/homelab-tools/certs
openssl rand -base64 32 | sudo tee /opt/step-ca/password.txt > /dev/null
sudo chown 1000:1000 /opt/step-ca/password.txt   # step-ca runs as uid 1000
sudo chmod 600 /opt/step-ca/password.txt
```

Back this file up. It unlocks the CA's keys.

**2. Compose file**

```yaml
secrets:
  ca_password:
    file: /opt/step-ca/password.txt

volumes:
  step_data:                    # the CA's keys and config; back this up too

services:
  step-ca:
    image: smallstep/step-ca:0.30.2
    container_name: step-ca
    restart: unless-stopped
    # ports: ["9000:9000"]      # only needed if other machines will request certificates
    secrets: [ca_password]
    environment:
      DOCKER_STEPCA_INIT_NAME: HomeLab CA
      DOCKER_STEPCA_INIT_DNS_NAMES: step-ca,ca.home.arpa,localhost
      DOCKER_STEPCA_INIT_PROVISIONER_NAME: admin@home.arpa
      DOCKER_STEPCA_INIT_PASSWORD_FILE: /run/secrets/ca_password
    volumes:
      - step_data:/home/step
    # The image's entrypoint creates the CA on first start, then runs this.
    # step-ca caps certificates at 24 hours by default; allow up to a year.
    command:
      - sh
      - -c
      - |
        step ca provisioner update admin@home.arpa \
          --x509-max-dur=8760h --x509-default-dur=2160h \
          --ca-config /home/step/config/ca.json
        exec step-ca --password-file /home/step/secrets/password /home/step/config/ca.json
    healthcheck:
      test: ["CMD", "step", "ca", "health", "--ca-url", "https://localhost:9000", "--root", "/home/step/certs/root_ca.crt"]
      interval: 5s
      retries: 20

  # One-shot: issues (or renews, within 30 days of expiry) the certificate, then exits.
  homelab-certs:
    image: smallstep/step-cli:0.31.0
    user: "0:0"                 # root, so it can hand the key to uid 10001
    depends_on:
      step-ca:
        condition: service_healthy
    secrets: [ca_password]
    environment:
      CERT_NAME: tools.home.arpa
      CERT_SANS: tools.home.arpa,192.168.1.20   # every name and IP people will type
      PROVISIONER: admin@home.arpa
    volumes:
      - step_data:/ca:ro
      - /opt/homelab-tools/certs:/certs
    command:
      - sh
      - -c
      - |
        set -e
        status=0
        step certificate needs-renewal /certs/fullchain.pem --expires-in 720h >/dev/null 2>&1 || status=$$?
        if [ "$$status" = 1 ]; then
          echo "Certificate is valid for more than 30 days; nothing to do."
          exit 0
        fi
        sans=""
        for s in $$(echo "$$CERT_SANS" | tr ',' ' '); do sans="$$sans --san $$s"; done
        step ca certificate "$$CERT_NAME" /certs/fullchain.pem /certs/privkey.pem $$sans \
          --ca-url https://step-ca:9000 --root /ca/certs/root_ca.crt \
          --provisioner "$$PROVISIONER" --provisioner-password-file /run/secrets/ca_password \
          --not-after 8760h --force
        cp /ca/certs/root_ca.crt /certs/root_ca.crt
        chown 10001:10001 /certs/fullchain.pem /certs/privkey.pem
        chmod 600 /certs/privkey.pem
        chmod 644 /certs/fullchain.pem /certs/root_ca.crt
        echo "Issued $$CERT_NAME ($$CERT_SANS), valid one year. Restart homelab-tools to load it."

  homelab-tools:
    image: ghcr.io/charleswolfe/wolfes-homelab-tools:latest
    container_name: homelab-tools
    restart: unless-stopped
    depends_on:
      homelab-certs:
        condition: service_completed_successfully
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
      HOSTNAMES: tools.home.arpa,192.168.1.20
      SITE_URL: https://tools.home.arpa
    mem_limit: 56m
```

`$$` is Compose's escape for a literal `$`, so the variables are expanded by the shell inside the container, not by Compose.

**3. Start it**

```sh
docker compose up -d
docker compose logs homelab-certs     # "Issued tools.home.arpa (...), valid one year."
ls -l /opt/homelab-tools/certs        # fullchain.pem  privkey.pem  root_ca.crt
```

On its very first start, step-ca prints the CA password to its log once. That's the password from `password.txt`.

**4. Trust the CA on each device** (once)

Copy `/opt/homelab-tools/certs/root_ca.crt` to each device and install it as a trusted root:

| Platform | How |
|---|---|
| macOS | Open the file → Keychain Access adds it to *login* → double-click it → Trust → "Always Trust". |
| Windows | Double-click → Install Certificate → Local Machine → "Trusted Root Certification Authorities". |
| Debian/Ubuntu | `sudo cp root_ca.crt /usr/local/share/ca-certificates/homelab-ca.crt && sudo update-ca-certificates` |
| Fedora/RHEL | `sudo cp root_ca.crt /etc/pki/ca-trust/source/anchors/ && sudo update-ca-trust` |
| Firefox | Settings → Privacy & Security → Certificates → View Certificates → Authorities → Import (or set `security.enterprise_roots.enabled` to use the OS store). |
| iOS / iPadOS | AirDrop or email the file → install the profile → Settings → General → About → Certificate Trust Settings → enable it. |
| Android | Settings → Security → Encryption & credentials → Install a certificate → CA certificate. |

Then browse to `https://tools.home.arpa`. Make sure your DNS (router, Pi-hole, AdGuard…) resolves that name to the Docker host.

**5. Renew**

The certificate lasts a year, and `homelab-certs` only replaces it in the last 30 days. Run it regularly, for example monthly from cron on the Docker host:

```sh
# crontab -e
0 4 1 * * cd /path/to/compose && docker compose run --rm homelab-certs && docker compose restart homelab-tools
```

**Variations**

- **Wildcard:** set `CERT_NAME: "*.home.arpa"` and `CERT_SANS: "*.home.arpa,home.arpa"` to cover every host under the domain with one certificate. Wildcards don't cover IP addresses; add any IPs to `CERT_SANS` as well.
- **Portainer:** paste the whole file into a stack (**Stacks → Add stack → Web editor**). The absolute `/opt/...` paths are required there.
- **Losing `step_data` creates a new CA** on the next start, and every device would need the new `root_ca.crt`. Back up the volume, e.g. `docker run --rm -v <project>_step_data:/d -v "$PWD":/b alpine tar czf /b/step_data.tgz -C /d .`
