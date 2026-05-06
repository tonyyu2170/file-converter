import { describe, expect, it } from "vitest";
import {
  AUDIO_BITRATE_OPTIONS,
  AUDIO_FORMAT_LOSSY,
  OUTPUT_EXTENSION,
  OUTPUT_MIME,
  defaultAudioConvertOptions,
  isLossy,
} from "./options";

describe("audio-convert options", () => {
  it("declares the four spec-mandated formats", () => {
    expect(Object.keys(OUTPUT_MIME)).toEqual(["mp3", "wav", "m4a", "flac"]);
    expect(Object.keys(OUTPUT_EXTENSION)).toEqual(["mp3", "wav", "m4a", "flac"]);
  });

  it("default outputFormat is null (user picks before conversion)", () => {
    expect(defaultAudioConvertOptions.outputFormat).toBeNull();
  });

  it("default bitrate is 192 kbps", () => {
    expect(defaultAudioConvertOptions.bitrate).toBe(192);
  });

  it("classifies mp3 and m4a as lossy; wav and flac as lossless", () => {
    expect(isLossy("mp3")).toBe(true);
    expect(isLossy("m4a")).toBe(true);
    expect(isLossy("wav")).toBe(false);
    expect(isLossy("flac")).toBe(false);
  });

  it("AUDIO_FORMAT_LOSSY matches isLossy()", () => {
    for (const fmt of Object.keys(OUTPUT_MIME) as Array<keyof typeof OUTPUT_MIME>) {
      expect(AUDIO_FORMAT_LOSSY[fmt]).toBe(isLossy(fmt));
    }
  });

  it("supported bitrate options are 64/128/192/256/320", () => {
    expect(AUDIO_BITRATE_OPTIONS).toEqual([64, 128, 192, 256, 320]);
  });
});
