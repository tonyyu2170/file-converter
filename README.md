# file-converter

Local, private file conversion. Files never leave your device — every conversion runs in a Web Worker in your browser, and the strict CSP on the deployed site structurally forbids the engines from making network requests.

- Live: https://file-converter-omega-rosy.vercel.app
- Spec: [`docs/superpowers/specs/2026-04-30-file-converter-design.md`](docs/superpowers/specs/2026-04-30-file-converter-design.md)
- Latest plan: [`docs/superpowers/plans/2026-05-04-phase-16-image-bg-remove.md`](docs/superpowers/plans/2026-05-04-phase-16-image-bg-remove.md)

## Status

Actively developed, plan-driven. 16 phases shipped to date; each phase adds one engine or one cross-cutting capability end-to-end.

## What it does

**Images**
- `image-convert` — heic, png, jpg, webp · convert between formats
- `image-resize` — png, jpg, jpeg, webp, heic · resize by px or %
- `image-bg-remove` — png, jpg, webp · cutout to transparent or solid color

**PDFs**
- `pdf-merge` — combine multiple pdfs into one
- `pdf-split` — extract page ranges from a pdf
- `image-to-pdf` — combine multiple images into a single pdf
- `pdf-to-image` — render each page as png or jpeg
- `pdf-to-md` — extract markdown from a pdf (heuristic)

**Documents**
- `docx-to-pdf` — render word documents as pdfs
- `docx-to-txt` — extract plain text from word documents
- `markdown-to-pdf` — render markdown as a styled pdf
- `txt-to-pdf` — render text verbatim as a monospace pdf

## Architecture

The privacy guarantee is the design constraint that everything else falls out of:

- **Static export only.** `next build` writes to `out/`; Vercel serves it. No serverless runtime in v1 — adding one would break the guarantee.
- **Engine pattern.** Each conversion lives in `src/engines/<id>/` with `index.ts`, `worker.ts`, and `options.ts`, registered in `_shared/registry.ts`. Adding a conversion is one folder + one registry line; UI components and routes do not change.
- **Web Workers via Comlink.** Every engine runs off the main thread. Workers are launched with `new Worker(new URL('./worker.ts', import.meta.url))` — Webpack dev server only, never `--turbopack` (its worker resolution is incomplete in Next.js 15).
- **Strict CSP in `vercel.json`.** `'wasm-unsafe-eval'` is allowed for libheif/ffmpeg; `'unsafe-eval'` and inline styles are not. Lint forbids `fetch`/`XMLHttpRequest` inside `src/engines/`, and a Playwright privacy-regression test asserts zero outbound network during conversion.

See [`CLAUDE.md`](CLAUDE.md) for the full set of invariants.

## Development

```bash
pnpm install
pnpm dev          # http://localhost:3000 (Webpack — NOT --turbopack)
pnpm typecheck
pnpm lint
pnpm test         # vitest (unit + integration + correctness)
pnpm test:e2e     # playwright (Chromium + Firefox + WebKit)
pnpm build        # static export to out/
```
