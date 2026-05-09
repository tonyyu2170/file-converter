import type { EngineCategory } from "./types";

// Source of truth: PRD §11.1. Update both sides of the test in
// size-limits.test.ts when changing these values.
export const SIZE_LIMITS_MB: Record<EngineCategory, { soft: number; hard: number }> = {
  image: { soft: 50, hard: 250 },
  pdf: { soft: 100, hard: 500 },
  document: { soft: 25, hard: 100 },
  audio: { soft: 100, hard: 500 },
  video: { soft: 50, hard: 100 },
  // OCR engines enforce their own per-engine cap (25 MB in image-to-text).
  // Provide generous defaults here so the shared size-check UI path doesn't
  // reject before the engine's own validate() runs.
  ocr: { soft: 25, hard: 25 },
  // Archive engines validate per-entry sizes internally. Hard cap covers
  // archive-create's 500 MB sum-of-inputs; soft cap (200 MB) is set so the
  // "may be slow" warning fires on batches that genuinely take noticeable
  // time to package, not on every multi-file drop.
  archive: { soft: 200, hard: 500 },
  // Data engines parse text trees into JS objects. 50 MB hard cap matches
  // the per-engine constants; soft cap (25 MB) sets the "may be slow"
  // warning at the threshold where in-browser parsing of large text trees
  // starts to feel sluggish on the 8 GB dev box.
  data: { soft: 25, hard: 50 },
} as const;

// SI thresholds (×1_000_000), matching the formatBytes helper.
const MB = 1_000_000;

export function softCapBytes(category: EngineCategory): number {
  return SIZE_LIMITS_MB[category].soft * MB;
}

export function hardCapBytes(category: EngineCategory): number {
  return SIZE_LIMITS_MB[category].hard * MB;
}
