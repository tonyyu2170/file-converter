import { describe, expect, it } from "vitest";
import { computeFrameStripWidthPx, validateFrameStripArgs } from "./frame-strip";

describe("validateFrameStripArgs", () => {
  it("accepts positive count, durationSec, sourceHeight", () => {
    expect(() =>
      validateFrameStripArgs({ count: 10, durationSec: 5, sourceHeight: 180 }),
    ).not.toThrow();
  });

  it("rejects zero count", () => {
    expect(() => validateFrameStripArgs({ count: 0, durationSec: 5, sourceHeight: 180 })).toThrow(
      /count must be positive/,
    );
  });

  it("rejects negative count", () => {
    expect(() => validateFrameStripArgs({ count: -1, durationSec: 5, sourceHeight: 180 })).toThrow(
      /count must be positive/,
    );
  });

  it("rejects zero durationSec", () => {
    expect(() => validateFrameStripArgs({ count: 10, durationSec: 0, sourceHeight: 180 })).toThrow(
      /durationSec must be positive/,
    );
  });

  it("rejects negative durationSec", () => {
    expect(() =>
      validateFrameStripArgs({ count: 10, durationSec: -0.5, sourceHeight: 180 }),
    ).toThrow(/durationSec must be positive/);
  });

  it("rejects zero sourceHeight", () => {
    expect(() => validateFrameStripArgs({ count: 10, durationSec: 5, sourceHeight: 0 })).toThrow(
      /sourceHeight must be positive/,
    );
  });
});

describe("computeFrameStripWidthPx", () => {
  it("computes width preserving native aspect — 320x180 source at 60px height → 107", () => {
    expect(computeFrameStripWidthPx(320, 180, 60)).toBe(107);
  });

  it("computes width for 16:9 1080p source at 60px height → 107", () => {
    expect(computeFrameStripWidthPx(1920, 1080, 60)).toBe(107);
  });

  it("computes width for 9:16 portrait source at 60px height → 34", () => {
    expect(computeFrameStripWidthPx(1080, 1920, 60)).toBe(34);
  });

  it("computes width for square source at 60px height → 60", () => {
    expect(computeFrameStripWidthPx(1000, 1000, 60)).toBe(60);
  });

  it("rounds to nearest pixel", () => {
    // 60 * 100 / 67 = 89.55 → 90
    expect(computeFrameStripWidthPx(100, 67, 60)).toBe(90);
  });
});
