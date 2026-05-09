import { describe, expect, it } from "vitest";
import { SIZE_LIMITS_MB, hardCapBytes, softCapBytes } from "./size-limits";

describe("SIZE_LIMITS_MB", () => {
  it("matches PRD §11.1 verbatim", () => {
    expect(SIZE_LIMITS_MB).toEqual({
      image: { soft: 50, hard: 250 },
      pdf: { soft: 100, hard: 500 },
      document: { soft: 25, hard: 100 },
      audio: { soft: 100, hard: 500 },
      video: { soft: 50, hard: 100 },
      // OCR engines (image-to-text) enforce their own cap; the shared UI
      // default matches the engine's own 25 MB hard limit.
      ocr: { soft: 25, hard: 25 },
      // Archive engines validate individual entry sizes internally;
      // category cap is the generous upper bound (covers archive-create's
      // 500 MB sum-of-inputs cap).
      archive: { soft: 100, hard: 500 },
    });
  });
});

describe("softCapBytes / hardCapBytes", () => {
  it("converts MB to bytes using SI thresholds (×1_000_000)", () => {
    expect(softCapBytes("image")).toBe(50_000_000);
    expect(hardCapBytes("image")).toBe(250_000_000);
    expect(softCapBytes("pdf")).toBe(100_000_000);
    expect(hardCapBytes("pdf")).toBe(500_000_000);
    expect(softCapBytes("document")).toBe(25_000_000);
    expect(hardCapBytes("document")).toBe(100_000_000);
    expect(softCapBytes("audio")).toBe(100_000_000);
    expect(hardCapBytes("audio")).toBe(500_000_000);
    expect(softCapBytes("video")).toBe(50_000_000);
    expect(hardCapBytes("video")).toBe(100_000_000);
    expect(softCapBytes("archive")).toBe(100_000_000);
    expect(hardCapBytes("archive")).toBe(500_000_000);
  });
});
