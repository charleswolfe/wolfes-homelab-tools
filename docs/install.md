# Install and run

## Get the image

### Pull the published image

```sh
docker pull ghcr.io/charleswolfe/wolfes-homelab-tools:latest
```

GitHub Actions builds and publishes it for `linux/amd64`, `linux/arm64` and `linux/arm/v7`, after the tests pass:

| Tag | Points to |
|---|---|
| `latest` | The newest commit on `main` |
| `1.2.3`, `1.2`, `1` | Released versions (git tags `v1.2.3`) |
| `sha-<commit>` | One exact commit, for pinning |

Every guide in these docs uses `ghcr.io/charleswolfe/wolfes-homelab-tools:latest`.

### Or build it yourself

```sh
git clone https://github.com/charleswolfe/wolfes-homelab-tools.git
cd wolfes-homelab-tools
npm test                           # optional; needs Node 20+
docker build -t homelab-tools .
```

Wherever the docs say `ghcr.io/charleswolfe/wolfes-homelab-tools:latest`, use `homelab-tools` instead.

The build pre-compresses the site and prints its size and the recommended memory limit:

```
homelab-tools build
  pages in sitemap     16 (http://localhost:8080)
  files served         6936
  JS + HTML            3.59 MiB
  all served files     33.41 MiB (incl. .br/.gz; brotli saved 24.60 MiB)
  memory-cache budget  33.41 MiB (100% of assets, capped at 50.00 MiB)
  recommended limit    56m  (server baseline + cache budget)
```

One optional build argument sets the address written into `sitemap.xml` and `robots.txt`. It can also be changed when the container starts, with the `SITE_URL` environment variable.

| Build arg | Default |
|---|---|
| `SITE_URL` | `http://localhost:8080` |

```sh
docker build -t homelab-tools --build-arg SITE_URL=https://tools.lan .
```

The image build doesn't run the tests; run `npm test` first if you've changed anything.

## Hosts without internet access

Get the image on a connected machine, for the offline host's CPU (`linux/amd64`, `linux/arm64` or `linux/arm/v7`), save it to a file and load it on the offline host:

```sh
# connected machine
docker pull --platform linux/amd64 ghcr.io/charleswolfe/wolfes-homelab-tools:latest
docker save ghcr.io/charleswolfe/wolfes-homelab-tools:latest | gzip > homelab-tools.tar.gz

# offline host
docker load < homelab-tools.tar.gz
```

To build instead of pulling, run `docker build --platform linux/amd64 -t homelab-tools .` on the connected machine and save `homelab-tools`.

In Portainer, use **Images → Import** and upload `homelab-tools.tar.gz`.

## Run it

```sh
docker run -d --name homelab-tools --restart unless-stopped \
  -p 8080:8080 --memory 56m \
  ghcr.io/charleswolfe/wolfes-homelab-tools:latest
```

Open `http://<host>:8080`. Everything works over plain HTTP except the tools that need [HTTPS](https.md); those pages show a banner explaining why.

The container runs as uid/gid `10001`, and the site files are read-only to it. `--read-only` (compose: `read_only: true`) works as well; the only thing it disables is rewriting the sitemap address via `SITE_URL`.

To see the image's size and memory recommendation:

```sh
docker run --rm ghcr.io/charleswolfe/wolfes-homelab-tools:latest info
```

## Update

```sh
docker pull ghcr.io/charleswolfe/wolfes-homelab-tools:latest
docker rm -f homelab-tools
# then run the same `docker run` command again
```

With Compose: `docker compose pull && docker compose up -d`. In a Portainer stack: **Pull and redeploy**.
