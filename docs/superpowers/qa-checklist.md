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

- [ ] Performance ≥ 95
- [ ] Accessibility ≥ 95
- [ ] Best Practices ≥ 95
- [ ] SEO ≥ 95

Record actual scores below; fix any score < 95 before declaring done.

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

| Date | Lighthouse perf / a11y / bp / seo | securityheaders | Deploy URL | Notes |
|------|-----------------------------------|-----------------|------------|-------|
| | | | | |
