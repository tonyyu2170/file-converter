import { describe, expect, it } from "vitest";
import engine from "./index";

describe("audio-trim engine descriptor", () => {
  it("declares id 'audio-trim' and category 'audio'", () => {
    expect(engine.id).toBe("audio-trim");
    expect(engine.category).toBe("audio");
  });

  it("is single-cardinality", () => {
    expect(engine.cardinality).toBe("single");
  });

  it("accepts mp3, wav, m4a, flac extensions", () => {
    expect(engine.inputAccept).toEqual(expect.arrayContaining([".mp3", ".wav", ".m4a", ".flac"]));
  });

  it("validate accepts a 1 MB mp3", () => {
    const file = new File([new Uint8Array(1_000_000)], "song.mp3", { type: "audio/mpeg" });
    const result = engine.validate(file, engine.defaultOptions);
    expect(result.ok).toBe(true);
  });

  it("validate rejects a non-audio extension", () => {
    const file = new File([new Uint8Array(100)], "doc.pdf", { type: "application/pdf" });
    const result = engine.validate(file, engine.defaultOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/MP3, WAV, M4A, or FLAC/i);
    }
  });

  it("validate rejects a > 500 MB file", () => {
    // File.size is a read-only getter; use defineProperty to shadow it
    // without allocating 600 MB of actual bytes.
    const file = new File([new Uint8Array([0])], "huge.mp3", { type: "audio/mpeg" });
    Object.defineProperty(file, "size", { value: 600 * 1_000_000 });
    const result = engine.validate(file, engine.defaultOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/500 MB/i);
    }
  });

  it("isReadyToConvert is false when end <= start", () => {
    expect(engine.isReadyToConvert?.({ ...engine.defaultOptions, startSec: 5, endSec: 5 })).toBe(
      false,
    );
    expect(engine.isReadyToConvert?.({ ...engine.defaultOptions, startSec: 10, endSec: 5 })).toBe(
      false,
    );
  });

  it("isReadyToConvert is false when range is shorter than 100 ms", () => {
    expect(
      engine.isReadyToConvert?.({ ...engine.defaultOptions, startSec: 1.0, endSec: 1.05 }),
    ).toBe(false);
  });

  it("isReadyToConvert is true for a 1 s range", () => {
    expect(
      engine.isReadyToConvert?.({ ...engine.defaultOptions, startSec: 1.0, endSec: 2.0 }),
    ).toBe(true);
  });

  it("OptionsPanel is wired", () => {
    expect(engine.OptionsPanel).toBeDefined();
  });
});
