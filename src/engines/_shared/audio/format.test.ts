// src/engines/_shared/audio/format.test.ts
import { describe, expect, it } from "vitest";
import {
  AUDIO_BITRATE_OPTIONS,
  AUDIO_FORMAT_LOSSY,
  isLossy,
  OUTPUT_EXTENSION,
  OUTPUT_MIME,
} from "./format";

describe("_shared/audio/format", () => {
  it("OUTPUT_MIME covers every AudioFormat", () => {
    expect(Object.keys(OUTPUT_MIME).sort()).toEqual(["flac", "m4a", "mp3", "wav"]);
  });

  it("OUTPUT_EXTENSION matches OUTPUT_MIME keys", () => {
    expect(Object.keys(OUTPUT_EXTENSION).sort()).toEqual(Object.keys(OUTPUT_MIME).sort());
  });

  it("AUDIO_FORMAT_LOSSY classifies mp3 and m4a as lossy, wav and flac as lossless", () => {
    expect(AUDIO_FORMAT_LOSSY).toEqual({ mp3: true, m4a: true, wav: false, flac: false });
  });

  it("isLossy mirrors the table", () => {
    expect(isLossy("mp3")).toBe(true);
    expect(isLossy("m4a")).toBe(true);
    expect(isLossy("wav")).toBe(false);
    expect(isLossy("flac")).toBe(false);
  });

  it("AUDIO_BITRATE_OPTIONS lists the supported MP3/AAC bitrates ascending", () => {
    expect(AUDIO_BITRATE_OPTIONS).toEqual([64, 128, 192, 256, 320]);
  });
});
