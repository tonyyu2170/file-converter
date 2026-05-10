# v1 release QA checklist

Run before marking v1 done. Each item is manual; record outcomes in the
section below.

## Lighthouse

Run on the deployed build (or a `pnpm build && pnpm preview` localhost
build):

```bash
npx @lhci/cli@latest autorun --collect.url=<deployed-url-or-http://localhost:3000>
```

Targets (master spec §17.4):

- [x] Performance ≥ 95
- [x] Accessibility ≥ 95
- [x] Best Practices ≥ 95
- [ ] SEO ≥ 95 — **deviation:** scored 60 on the team-prefix
      `*.vercel.app` host because Vercel auto-injects `x-robots-tag:
      noindex` on those subdomains to prevent SEO duplication with the
      project's canonical URL. The single failing audit is
      `is-crawlable`. Will resolve when a custom domain is wired
      (post-v1); the noindex header is not present on custom domains.
      No code change required.

Record actual scores below; fix any score < 95 before declaring done
(SEO exempted per the deviation above).

## securityheaders.com

Run https://securityheaders.com against the deployed URL.

- [x] Grade A (or A+)
- [x] HSTS `max-age` ≥ 31_536_000
- [x] CSP includes `connect-src 'self'`
- [x] CSP includes `style-src 'self'` (no `'unsafe-inline'` in style-src)
- [x] X-Frame-Options DENY
- [x] X-Content-Type-Options nosniff
- [x] Referrer-Policy set
- [x] Permissions-Policy restricts camera, microphone, geolocation,
      interest-cohort

## Deploy validation (curl checks)

Replace `<URL>` with the deployed URL.

- [x] `curl -sI <URL>/onnx-wasm/ort-wasm-simd-threaded.wasm | grep -i cache-control`
      → `public, max-age=31536000, immutable`

- [x] `curl -sI <URL>/models/bg-remove/onnx/model_quantized.onnx | grep -i cache-control`
      → `public, max-age=31536000, immutable`

- [x] `curl -sI <URL>/ | grep -i strict-transport-security`
      → `max-age=63072000; includeSubDomains; preload` (or equivalent ≥ 1y)

- [x] HTTP → HTTPS redirect:
      `curl -sI http://<URL-without-protocol>/ | head -1`
      → `301` or `308` to `https://...`

## Manual privacy verification

The §10.3 demonstration. Must be repeatable by anyone reading the
/about page.

- [x] Open the deployed URL in Chrome.
- [x] DevTools → Network → Fetch/XHR filter.
- [x] Drop a file in `/tools/pdf-merge` (drag in two fixture PDFs).
- [x] Click Convert.
- [x] Confirm: no requests are made during the conversion. Page-load
      assets show on first visit, then cached.

## Latest run

| Date | Lighthouse perf / a11y / bp / seo (median of 3) | securityheaders | Deploy URL | Notes |
|------|-------------------------------------------------|-----------------|------------|-------|
| 2026-05-05 | 99 / 100 / 100 / 60 | A | https://file-converter-tonyyu2170s-projects.vercel.app | SEO=60 is `*.vercel.app` `x-robots-tag: noindex` (deviation documented above). Vercel Toolbar disabled in production to satisfy strict CSP. Sidebar touch-target fix landed in `cee2c8e`. Perf raw runs: 91, 99, 100 (typical LCP variance on cold edge cache). Manual privacy verification: zero requests during /tools/pdf-merge conversion (Chrome DevTools, Network/XHR filter). |

## v2 deploy validation

Run after Phase 26 merges to `main` and Vercel deploys. Replace
`<URL>` with the deployed URL.

### Headers

- [ ] `curl -sI <URL>/ | grep -i cross-origin-opener-policy`
      → `same-origin`
- [ ] `curl -sI <URL>/ | grep -i cross-origin-embedder-policy`
      → `require-corp`
- [ ] `curl -sI <URL>/tesseract/eng.traineddata.gz | grep -i cache-control`
      → `public, max-age=31536000, immutable`
- [ ] `curl -sI <URL>/ffmpeg/mt/ffmpeg-core.wasm | grep -i cache-control`
      → `public, max-age=31536000, immutable`

### securityheaders.com

- [ ] Grade A (or A+) with COOP/COEP set — re-graded post-v2.

### Manual privacy verification — one engine per new family

The §10.3 demonstration, exercised across each v2 family. Open the
deployed URL in Chrome with DevTools → Network → Fetch/XHR filter.

- [ ] **Audio** — drop a small mp3 in `/tools/audio-convert`,
      transcode to wav, confirm zero requests during conversion.
- [ ] **Video** — drop a small mp4 in `/tools/video-convert`,
      transcode to mp4 at low quality, confirm zero requests.
- [ ] **OCR** — drop a screenshot in `/tools/image-to-text`, run
      recognition, confirm zero requests during recognition (the
      `eng.traineddata.gz` fetch happens on first navigation; the
      conversion itself must show none).
- [ ] **Archives** — drop a sample.zip in `/tools/archive-extract`,
      extract, confirm zero requests.
- [ ] **Data** — drop a sample.json in `/tools/json-format`, pretty
      print, confirm zero requests.

### v2 Lighthouse run

Targets per master spec §17.4 + v2 design §12.4.

- [ ] Performance ≥ 95 on `/`
- [ ] Accessibility ≥ 95 on `/`
- [ ] Best Practices ≥ 95 on `/`
- [ ] Performance ≥ 95 on `/about`
- [ ] One representative new-family route ≥ 95 (audio-convert,
      video-trim, archive-create, image-to-text, data-convert).
      Audio/video/OCR routes are *expected* to score lower on
      first-conversion latency due to lazy-load WASM; the home /
      about scores carry the bar.

### Latest run (v2)

| Date | URL | Headers | securityheaders | Lighthouse home | Notes |
|------|-----|---------|-----------------|-----------------|-------|
|      |     |         |                 |                 |       |
