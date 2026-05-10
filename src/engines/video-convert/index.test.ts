import { describe, expect, it } from "vitest";
import engine from "./index";
import { defaultVideoConvertOptions } from "./options";

function fakeFile(name: string, sizeBytes: number, type = ""): File {
  return new File([new Uint8Array(Math.min(sizeBytes, 16))], name, { type });
}

describe("video-convert engine descriptor", () => {
  it("declares id, category, license, and library", () => {
    expect(engine.id).toBe("video-convert");
    expect(engine.category).toBe("video");
    expect(engine.cardinality).toBe("single");
    expect(engine.license).toBe("GPL-2.0-or-later");
    expect(engine.library).toMatch(/ffmpeg/i);
  });

  it("accepts mp4, mov, webm, mkv inputs", () => {
    expect(engine.inputAccept).toEqual([".mp4", ".mov", ".webm", ".mkv"]);
  });

  it("isReadyToConvert is false until outputFormat is chosen", () => {
    expect(engine.isReadyToConvert?.(defaultVideoConvertOptions)).toBe(false);
    expect(engine.isReadyToConvert?.({ outputFormat: "mp4", quality: "medium" })).toBe(true);
  });

  it("validates a known mp4 file by extension", () => {
    const file = fakeFile("clip.mp4", 1024, "video/mp4");
    const result = engine.validate(file, defaultVideoConvertOptions);
    expect(result).toEqual({ ok: true });
  });

  it("validates a known mkv file even with empty mime", () => {
    const file = fakeFile("clip.mkv", 1024, "");
    const result = engine.validate(file, defaultVideoConvertOptions);
    expect(result).toEqual({ ok: true });
  });

  it("rejects unsupported extensions", () => {
    const file = fakeFile("song.mp3", 1024, "audio/mpeg");
    const result = engine.validate(file, defaultVideoConvertOptions);
    expect(result.ok).toBe(false);
  });

  it("rejects files above the 100 MB cap", () => {
    // MAX_FILE_BYTES = 100 * 1024 * 1024 = 104_857_600 (binary MB).
    // Use 200 MB to make the over-cap intent obvious.
    const file = fakeFile("big.mp4", 16, "video/mp4");
    Object.defineProperty(file, "size", { value: 200 * 1024 * 1024 });
    const result = engine.validate(file, defaultVideoConvertOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/100\s*MB/i);
    }
  });
});
