import { describe, expect, it } from "vitest";
import { type Peaks, peaksFromPCM } from "./decode-peaks";

/** Synthesize one second of a 440 Hz sine wave at the given sample rate. */
function makeSinePCM(durationSec: number, sampleRate: number, freqHz = 440): Float32Array {
  const n = Math.round(durationSec * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  }
  return out;
}

describe("peaksFromPCM", () => {
  it("returns Peaks with min/max arrays of length bucketCount", () => {
    const pcm = makeSinePCM(1, 8000);
    const p: Peaks = peaksFromPCM(pcm, 64);
    expect(p.min.length).toBe(64);
    expect(p.max.length).toBe(64);
  });

  it("produces non-zero magnitudes across all buckets for a non-trivial signal", () => {
    const pcm = makeSinePCM(1, 8000);
    const p = peaksFromPCM(pcm, 64);
    for (let i = 0; i < 64; i++) {
      expect(Math.abs(p.max[i] ?? 0)).toBeGreaterThan(0);
      expect(Math.abs(p.min[i] ?? 0)).toBeGreaterThan(0);
    }
  });

  it("min values are <= 0 and max values are >= 0", () => {
    const pcm = makeSinePCM(1, 8000);
    const p = peaksFromPCM(pcm, 64);
    for (let i = 0; i < 64; i++) {
      expect(p.min[i] ?? 0).toBeLessThanOrEqual(0);
      expect(p.max[i] ?? 0).toBeGreaterThanOrEqual(0);
    }
  });

  it("max approaches 1 and min approaches -1 for a full-amplitude sine across enough samples", () => {
    const pcm = makeSinePCM(1, 48000);
    const p = peaksFromPCM(pcm, 16); // 3000 samples per bucket — many full cycles each
    for (let i = 0; i < 16; i++) {
      expect(p.max[i] ?? 0).toBeGreaterThan(0.99);
      expect(p.min[i] ?? 0).toBeLessThan(-0.99);
    }
  });

  it("returns empty arrays when given empty PCM", () => {
    const p = peaksFromPCM(new Float32Array(0), 32);
    expect(p.min.length).toBe(32);
    expect(p.max.length).toBe(32);
    expect(p.min.every((v) => v === 0)).toBe(true);
    expect(p.max.every((v) => v === 0)).toBe(true);
  });

  it("throws when bucketCount is <= 0", () => {
    const pcm = makeSinePCM(0.1, 8000);
    expect(() => peaksFromPCM(pcm, 0)).toThrow();
    expect(() => peaksFromPCM(pcm, -1)).toThrow();
  });
});
