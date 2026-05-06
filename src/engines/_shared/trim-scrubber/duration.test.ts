import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readMediaDurationSec } from "./duration";

// NOTE: The audio-modality test is intentionally skipped under vitest's
// default jsdom environment, because jsdom's HTMLMediaElement is a stub
// that never fires `loadedmetadata` against blob URLs. The live audio
// probe behavior is covered by tests/e2e/audio-trim.spec.ts and the
// gated correctness suite in tests/e2e/audio-trim-correctness.spec.ts
// (Task 11). This file's video-modality test is ungated and runs under
// any environment.

/**
 * jsdom's HTMLMediaElement is a stub: it exposes the DOM API surface but
 * does not actually decode media data, so `loadedmetadata` never fires
 * against blob URLs. Detect jsdom by its user-agent string (contains
 * "jsdom/") and skip the live probe in that environment. The real audio
 * duration path is exercised by Task 11's Playwright E2E test against a
 * genuine browser.
 */
const isJsdom = typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom/");

/** Synthesize a minimal valid WAV blob of the given duration at 8 kHz mono i16le.
 *  Used to exercise the <audio>.duration probe without a fixture. */
function makeSilentWav(durationSec: number): File {
  const sampleRate = 8000;
  const numSamples = Math.round(durationSec * sampleRate);
  const dataBytes = numSamples * 2; // i16
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);
  // RIFF header
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataBytes, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataBytes, true);
  // Samples are zero (silence); already initialized by ArrayBuffer.
  return new File([buf], `silent-${durationSec}s.wav`, { type: "audio/wav" });
}

describe("readMediaDurationSec", () => {
  it.runIf(!isJsdom)(
    "returns the duration of a synthesized WAV within ±50 ms (audio modality)",
    async () => {
      const file = makeSilentWav(2.0);
      const d = await readMediaDurationSec(file, "audio");
      expect(d).toBeGreaterThan(1.95);
      expect(d).toBeLessThan(2.05);
    },
  );

  it("throws for the video modality (deferred to phase 22)", async () => {
    const file = makeSilentWav(0.5);
    await expect(readMediaDurationSec(file, "video")).rejects.toThrow(/video.*phase 22/i);
  });
});

describe("readMediaDurationSec watchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it(
    // Runs under jsdom: jsdom's <audio> stub never fires loadedmetadata or
    // error, so the only settle path is the 10s watchdog.
    "rejects with a timeout error when metadata never arrives within 10s",
    async () => {
      const file = new File(
        [new Uint8Array([0, 1, 2, 3])],
        "garbage.bin",
        { type: "application/octet-stream" },
      );
      const promise = readMediaDurationSec(file, "audio");
      // Attach the rejection handler before advancing timers so the
      // rejection isn't treated as unhandled.
      const rejection = expect(promise).rejects.toThrow(
        /media metadata timeout/i,
      );
      await vi.advanceTimersByTimeAsync(10_001);
      await rejection;
    },
  );
});
