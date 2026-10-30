# Changelog

Notable changes to Homelab Tools. Versions follow [Semantic Versioning](https://semver.org): a new tool or option is a minor version, a fix is a patch, and anything that breaks an existing setup (a removed environment variable, a changed port) is a major version.

Each version's section becomes the notes of its GitHub release.

## [1.0.1] - 2026-10-30

### Added

- **SPF & DMARC Checker** (Network): look up a domain's SPF, DMARC and DKIM records, or paste one to check it offline. Follows SPF includes to count the 10-DNS-lookup limit (and void lookups), flags invalid terms, `+all`/`?all`, `ptr` and duplicate records, and lists every allowed address range. Explains each DMARC tag, summarises the policy, falls back to the parent domain, and checks that outside report addresses have authorised reports. Finds DKIM keys at a given or common selectors and reports key type and size.
- **DNS Lookup** (Network): look up A, AAAA, CNAME, MX, TXT, NS, SOA, SRV, CAA, PTR, HTTPS, DS, DNSKEY and other records over DNS-over-HTTPS, through Cloudflare, Google, Control D, your own resolver, or a `/dns-query` route on your reverse proxy. Shows DNSSEC validation and Extended DNS Errors, looks up reverse names for IP addresses, checks all common records at once, compares resolvers' answers, and gives a dig-style raw view. Queries are sent only when you click Look up.
- **Pixel Art Maker** (Generate): a retro paint program for pixel art, with pencil, line (Shift snaps to 45°) and eraser tools, brush sizes, the classic 16-colour palette or any colour, Alt-click to pick a colour, undo/redo, zoom with a pixel grid, and keyboard shortcuts. Opens existing images and saves 24-bit BMP files; small drawings are kept across reloads.
- **VIA keycap looks:** the 2D keyboard now has shaded, physical-looking keycaps and case; a new default **GAMER** theme (flat black caps, neon legends, RGB backlight in the site's palette) and a retro platinum **HOMELAB** theme. The grey haze behind the keyboard is gone. Browsers with an older saved keycap theme switch to the new default once.
- **Image Converter** (Convert): convert and resize images to PNG, JPEG, WebP or AVIF (where the browser can encode it), one at a time or in batches with a zip download. Metadata such as GPS location is not carried over. Accepts PNG, JPEG, WebP, GIF, BMP, SVG, AVIF, ICO, and HEIC in browsers that can open it.

### Changed

- **Privacy:** DNS Lookup and the SPF & DMARC Checker are the only pages allowed to contact other hosts, and only DNS resolvers (`connect-src`), when you click the button. Scripts, styles, fonts and images on every page still load from your server alone, and the test suite still enforces that.

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
