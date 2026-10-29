# Build the Docker image

```sh
git clone <this repo> && cd wolfes-homelab-tools
docker build -t homelab-tools .
```

The build pre-compresses the site and prints its size and the recommended memory limit:

```
homelab-tools build
  pages in sitemap     14 (http://localhost:8080)
  files served         6912
  JS + HTML            3.46 MiB
  all served files     33.26 MiB (incl. .br/.gz; brotli saved 24.51 MiB)
  memory-cache budget  33.26 MiB (100% of assets, capped at 50.00 MiB)
  recommended limit    56m  (server baseline + cache budget)
```

Only `package.json`, `scripts/`, `site/` and `docker/` are sent to Docker (see `.dockerignore`), and the files that change most are copied last, so editing a page rebuilds only the final layers.

Tests aren't part of the image build. Run `npm test` first when you've changed anything (see [Development](development.md)).

Optional build argument:

| Build arg | Default | Purpose |
|---|---|---|
| `SITE_URL` | `http://localhost:8080` | Base URL written into `sitemap.xml` and `robots.txt`. Can also be changed at runtime with the `SITE_URL` env var. |

```sh
docker build -t homelab-tools --build-arg SITE_URL=https://tools.lan .
```

## Hosts without internet access

Building needs to pull the base images (`node`, `busybox`, `static-web-server`) once. On an offline Docker host, build on a connected machine and copy the image across:

```sh
# connected machine (build for the target's CPU, e.g. linux/amd64 or linux/arm64)
docker build --platform linux/amd64 -t homelab-tools .
docker save homelab-tools | gzip > homelab-tools.tar.gz

# offline host
docker load < homelab-tools.tar.gz
```

In Portainer: **Images → Import** and upload `homelab-tools.tar.gz`.

## Run it

```sh
docker run -d --name homelab-tools --restart unless-stopped \
  -p 8080:8080 --memory 56m \
  homelab-tools
```

Open `http://<host>:8080`. Everything works over plain HTTP except the tools that need [HTTPS](https.md). Those pages show a banner explaining why.

To see the size and memory recommendation for an image: `docker run --rm homelab-tools info`.
