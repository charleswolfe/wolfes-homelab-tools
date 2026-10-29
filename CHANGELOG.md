# Changelog

Notable changes to Homelab Tools. Versions follow [Semantic Versioning](https://semver.org): a new tool or option is a minor version, a fix is a patch, and anything that breaks an existing setup (a removed environment variable, a changed port) is a major version.

Each version's section becomes the notes of its GitHub release.

## [1.0.0] - 2026-10-29

First release. Fifteen utilities that run entirely in the browser, packaged as one small container image.

### Tools

- **Generate:** QR Code Generator (URLs, Wi-Fi, vCards and more, with colours and a centre logo), Password Generator (passwords and EFF word-list passphrases, with exact entropy), UUID Generator (v4 and v7), Hash Generator (SHA-256/384/512 and MD5, for text or files).
- **Convert:** Base64, URL Encode / Decode, Case Converter, JSON ↔ YAML, Timestamp Converter.
- **Inspect & Validate:** JSON Formatter, JWT Decoder, Regex Tester.
- **Network:** IP Subnet Calculator (IPv4 and IPv6: ranges, masks, splitting, membership checks, reverse DNS zones).
- **Hardware & Crypto:** Bitcoin Paper Wallet (Legacy, SegWit and Taproot), VIA Keyboard Configurator (QMK keyboards over WebHID).

### Privacy

- No page contacts another host: no CDNs, web fonts, analytics or trackers. A same-origin Content-Security-Policy enforces it, and the test suite fails if an outside URL or tracker appears.
- The Bitcoin wallet and password generator get a stricter policy that blocks all network access, even to this server.
- Pages that need or benefit from HTTPS show a banner explaining why when opened over plain HTTP.

### Container image

- `ghcr.io/charleswolfe/wolfes-homelab-tools` for `linux/amd64`, `linux/arm64` and `linux/arm/v7`, built from `scratch` (about 13 MB) and served by static-web-server as a non-root user.
- Every file pre-compressed (brotli and gzip) and kept in memory; 56 MB recommended memory limit.
- HTTPS with mounted certificates or Compose secrets, optional HTTP-to-HTTPS redirect and HSTS, configured with environment variables.
- Published with an SBOM and build provenance.
