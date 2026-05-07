import type { EngineCategory } from "./types";

// Source of truth: PRD §11.1. Update both sides of the test in
// size-limits.test.ts when changing these values.
export const SIZE_LIMITS_MB: Record<EngineCategory, { soft: number; hard: number }> = {
  image: { soft: 50, hard: 250 },
  pdf: { soft: 100, hard: 500 },
  document: { soft: 25, hard: 100 },
  audio: { soft: 100, hard: 500 },
  video: { soft: 50, hard: 100 },
} as const;

// SI thresholds (×1_000_000), matching the formatBytes helper.
const MB = 1_000_000;

export function softCapBytes(category: EngineCategory): number {
  return SIZE_LIMITS_MB[category].soft * MB;
}

export function hardCapBytes(category: EngineCategory): number {
  return SIZE_LIMITS_MB[category].hard * MB;
}
