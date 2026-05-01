# file-converter

Local, private file conversion. Files never leave your device.

- Live: https://file-converter-omega-rosy.vercel.app
- Spec: [`docs/superpowers/specs/2026-04-30-file-converter-design.md`](docs/superpowers/specs/2026-04-30-file-converter-design.md)
- Plan 1: [`docs/superpowers/plans/2026-04-30-phase-1-foundation-and-heic-slice.md`](docs/superpowers/plans/2026-04-30-phase-1-foundation-and-heic-slice.md)

## Development

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm test         # vitest
pnpm test:e2e     # playwright
pnpm build        # static export to out/
```

## Phase 1 scope

- HEIC → PNG conversion in the browser via libheif-js.
- Strict CSP, all conversion in Web Workers, no backend.
- Privacy regression test asserts zero outbound network on every PR.
