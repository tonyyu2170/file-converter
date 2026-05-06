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

- [ ] Grade A (or A+)
- [ ] HSTS `max-age` ≥ 31_536_000
- [ ] CSP includes `connect-src 'self'`
- [ ] CSP includes `style-src 'self'` (no `'unsafe-inline'` in style-src)
- [ ] X-Frame-Options DENY
- [ ] X-Content-Type-Options nosniff
- [ ] Referrer-Policy set
- [ ] Permissions-Policy restricts camera, microphone, geolocation,
      interest-cohort

## Deploy validation (curl checks)

Replace `<URL>` with the deployed URL.

- [ ] `curl -sI <URL>/onnx-wasm/ort-wasm-simd-threaded.wasm | grep -i cache-control`
      → `public, max-age=31536000, immutable`

- [ ] `curl -sI <URL>/models/bg-remove/onnx/model_quantized.onnx | grep -i cache-control`
      → `public, max-age=31536000, immutable`

- [ ] `curl -sI <URL>/ | grep -i strict-transport-security`
      → `max-age=63072000; includeSubDomains; preload` (or equivalent ≥ 1y)

- [ ] HTTP → HTTPS redirect:
      `curl -sI http://<URL-without-protocol>/ | head -1`
      → `301` or `308` to `https://...`

## Manual privacy verification

The §10.3 demonstration. Must be repeatable by anyone reading the
/about page.

- [ ] Open the deployed URL in Chrome.
- [ ] DevTools → Network → Fetch/XHR filter.
- [ ] Drop a file in `/tools/pdf-merge` (drag in two fixture PDFs).
- [ ] Click Convert.
- [ ] Confirm: no requests are made during the conversion. Page-load
      assets show on first visit, then cached.

## Latest run

| Date | Lighthouse perf / a11y / bp / seo (median of 3) | securityheaders | Deploy URL | Notes |
|------|-------------------------------------------------|-----------------|------------|-------|
| 2026-05-05 | 99 / 100 / 100 / 60 | pending | https://file-converter-tonyyu2170s-projects.vercel.app | SEO=60 is `*.vercel.app` `x-robots-tag: noindex` (deviation documented above). Vercel Toolbar disabled in production to satisfy strict CSP. Sidebar touch-target fix landed in `cee2c8e`. Perf raw runs: 91, 99, 100 (typical LCP variance on cold edge cache). |
