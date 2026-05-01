# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Greenfield. As of 2026-04-30 the only committed artifacts are the PRD/spec, Plan 1, and `.gitignore` — no code, no `package.json`, no scaffolding yet. Implementation is **plan-driven**: a sequence of phased plans under `docs/superpowers/plans/` is executed one at a time. Each plan ships working software end-to-end.

**Read these before writing code:**

1. `docs/superpowers/specs/2026-04-30-file-converter-design.md` — the PRD. Source of truth for architecture, tech stack, security model, UX, success criteria. If a decision is documented here, do not relitigate it without an explicit user prompt.
2. `docs/superpowers/plans/<latest>.md` — the active phase plan. Contains tasks in checkbox form and "Verify pass/fail" steps that are mandatory.

When asked to "execute the plan," invoke the `superpowers:executing-plans` skill (inline) or `superpowers:subagent-driven-development` (one fresh subagent per task with review checkpoints) — both are referenced from Plan 1's preamble. Don't freelance the plan order.

## What this project is

A client-side-only file converter (HEIC→PNG, PDF merge, DOCX→PDF, etc.) deployed as a static site to Vercel. The defining property is that **files never traverse the network** — every conversion runs in a Web Worker in the user's browser. Static export + strict CSP makes this structurally enforceable, not just a promise.

## Architecture (the load-bearing parts)

### Engine pattern — the multiplicative thing

Every conversion is a self-contained module under `src/engines/<id>/` exporting a `ConversionEngine` (defined in `src/engines/_shared/types.ts`):

```typescript
type ConversionEngine<TOptions, TOutput> =
  | SingleInputEngine<TOptions, TOutput>   // HEIC→PNG, DOCX→PDF, …
  | MultiInputEngine<TOptions, TOutput>;   // pdf-merge, image-to-pdf, …
```

Each engine folder contains `index.ts` (the engine export), `worker.ts` (the Comlink-exposed worker doing the actual conversion), and `options.ts`. Engines are registered in `src/engines/_shared/registry.ts` as `id → dynamic-import` entries.

**Adding a new conversion is a single PR that adds one folder under `src/engines/` plus one registry line. UI components, hooks, and routes do not change** — `_shared/harness.ts` adapts the UI generically based on engine metadata. If you find yourself editing shared code to add an engine, stop: the abstraction is leaking and the design has gone wrong.

### Other invariants

- **Static export only.** `next build` writes to `out/` and Vercel serves it. There is no serverless runtime in v1. Adding one breaks the privacy guarantee.
- **Security headers live in `vercel.json`, not `next.config.ts`.** Static export bypasses the Next.js server, so `headers()` in `next.config.ts` is a no-op for production. Easy mistake.
- **`'wasm-unsafe-eval'` is allowed in `script-src`** for libheif/ffmpeg. **`'unsafe-eval'` is not, and `'unsafe-inline'` is not allowed in `style-src`.** If shadcn/ui or any library injects runtime `<style>` tags, fix the build (precompile, restyle, or drop the offender) — do not relax the header.
- **No `fetch` / `XMLHttpRequest` inside `src/engines/`.** A Biome lint rule enforces this; the privacy regression Playwright test asserts zero outbound network during conversion. Both must stay green.
- **Workers are launched via `new Worker(new URL('./worker.ts', import.meta.url))`** with Comlink-typed RPC. **Do not use `next dev --turbopack`** — Turbopack's worker resolution is incomplete in Next.js 15 and will break this pattern. Default Webpack dev server only.
- **TypeScript strict** with `noUncheckedIndexedAccess` and `noImplicitOverride` on. Don't suppress; fix.

## Commands (available after Plan 1 Task 1 scaffolds the project)

```bash
pnpm dev            # Webpack dev server — NOT --turbopack (see invariants)
pnpm build          # static export to out/
pnpm typecheck      # tsc --noEmit
pnpm lint           # biome check src tests
pnpm lint:fix       # biome check --write
pnpm test           # vitest run (unit + integration + correctness)
pnpm test:watch
pnpm test:e2e       # playwright (Chromium + Firefox + WebKit)
pnpm test:e2e:ui
```

Run a single Vitest file: `pnpm test src/engines/heic-to-png/index.test.ts`.
Run a single Playwright spec: `pnpm test:e2e tests/e2e/heic-to-png.spec.ts`.

Until Plan 1 Task 1 lands, none of these exist — read the plan to see what's being added in the current task.

## Testing conventions

- **No mocks for conversion libraries.** Correctness tests run real libheif, real pdf-lib, etc. against committed fixtures in `tests/fixtures/`.
- **Unit tests are co-located** (`foo.ts` next to `foo.test.ts`). E2E tests live under `tests/e2e/`.
- **`tests/fixtures/sample.heic` must be acquired manually** before HEIC engine tests can run — Plan 1 Task 9 documents two acquisition paths. CI fixtures are committed to the repo (each < 1 MB).
- **Chrome QA workflow.** When `--chrome` is enabled, drive the dev server in Chrome to screenshot rendered states and verify drag-drop interactions during implementation. This is a *complement to* — not a substitute for — Playwright E2E.

## Repo / commit conventions

- **Never include Claude attribution in commit messages.** No `Co-Authored-By: Claude`, no "Generated with Claude Code" footers. This is enforced as user preference.
- **Never use `--no-verify` or skip hooks.** If a pre-commit hook fails, fix the underlying issue and create a new commit.
- **Commit message body lines stay under 72 characters.**
- **Always create new commits, do not amend** (default project posture; --amend can destroy in-progress work, especially after hook failures).
- **Plans live under `docs/superpowers/plans/`, specs under `docs/superpowers/specs/`** — both are dated (`YYYY-MM-DD-slug.md`) and committed to main.
- **`.superpowers/`** is gitignored — it holds brainstorming-server session state, not durable artifacts.

## When in doubt

- Architecture question → re-read the relevant section of the spec before proposing changes.
- "Should I add X to v1?" → check Section 3 (Non-goals) and Section 16 (Future scope) of the spec. Most "natural extensions" are deliberately deferred.
- Stuck on a plan task → run the verify step that is failing and read the actual output. Don't paper over divergences from "Expected."
