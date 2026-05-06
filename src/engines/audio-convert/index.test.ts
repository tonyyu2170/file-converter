import { describe, expect, it } from "vitest";
import engine from "./index";

describe("audio-convert engine descriptor", () => {
  it("registers under id 'audio-convert' in the audio category", () => {
    expect(engine.id).toBe("audio-convert");
    expect(engine.category).toBe("audio");
    expect(engine.cardinality).toBe("single");
  });

  it("declares the four spec-mandated formats in inputAccept and inputMime", () => {
    expect(engine.inputAccept).toEqual([".mp3", ".wav", ".m4a", ".flac"]);
    expect(engine.inputMime).toEqual(["audio/mpeg", "audio/wav", "audio/mp4", "audio/flac"]);
  });

  it("declares ffmpeg.wasm as the library with GPL-2.0-or-later license", () => {
    expect(engine.library).toMatch(/ffmpeg\.wasm/i);
    expect(engine.license).toBe("GPL-2.0-or-later");
  });

  it("validate rejects files with the wrong extension", () => {
    const file = new File(["x"], "image.png", { type: "image/png" });
    if (engine.cardinality !== "single") throw new Error("expected single-input");
    const result = engine.validate(file, engine.defaultOptions);
    expect(result.ok).toBe(false);
  });

  it("validate accepts a 1 KB MP3 file by extension", () => {
    const file = new File(["x".repeat(1000)], "song.mp3", { type: "audio/mpeg" });
    if (engine.cardinality !== "single") throw new Error("expected single-input");
    const result = engine.validate(file, engine.defaultOptions);
    expect(result.ok).toBe(true);
  });

  it("validate rejects files larger than 500 MB", () => {
    const file = new File(["x"], "song.mp3", { type: "audio/mpeg" });
    Object.defineProperty(file, "size", { value: 501 * 1_000_000 });
    if (engine.cardinality !== "single") throw new Error("expected single-input");
    const result = engine.validate(file, engine.defaultOptions);
    expect(result.ok).toBe(false);
  });

  it("isReadyToConvert returns false until outputFormat is set", () => {
    expect(engine.isReadyToConvert?.(engine.defaultOptions)).toBe(false);
    expect(engine.isReadyToConvert?.({ ...engine.defaultOptions, outputFormat: "mp3" })).toBe(true);
  });
});
