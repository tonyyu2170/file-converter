// src/engines/video-extract-audio/options.test.ts
import { describe, expect, it } from "vitest";
import {
  SAME_OUTPUT_FALLBACK,
  VIDEO_EXTRACT_AUDIO_FORMATS,
  defaultVideoExtractAudioOptions,
  isLossy,
  sameOutputFor,
} from "./options";

describe("video-extract-audio options", () => {
  it("default is same / 192 kbps", () => {
    expect(defaultVideoExtractAudioOptions).toEqual({
      outputFormat: "same",
      bitrate: 192,
    });
  });

  it("format list mirrors audio-trim exactly", () => {
    expect(VIDEO_EXTRACT_AUDIO_FORMATS).toEqual(["same", "mp3", "wav", "m4a", "flac"]);
  });

  it("re-exports isLossy from _shared/audio/format", () => {
    expect(isLossy("mp3")).toBe(true);
    expect(isLossy("wav")).toBe(false);
  });

  it("sameOutputFor maps common audio codecs to canonical containers", () => {
    expect(sameOutputFor("aac")).toEqual({ ext: "m4a", mime: "audio/mp4" });
    expect(sameOutputFor("mp3")).toEqual({ ext: "mp3", mime: "audio/mpeg" });
    expect(sameOutputFor("opus")).toEqual({ ext: "opus", mime: "audio/ogg" });
    expect(sameOutputFor("vorbis")).toEqual({ ext: "ogg", mime: "audio/ogg" });
    expect(sameOutputFor("flac")).toEqual({ ext: "flac", mime: "audio/flac" });
  });

  it("sameOutputFor maps any PCM family codec to .wav", () => {
    expect(sameOutputFor("pcm_s16le")).toEqual({ ext: "wav", mime: "audio/wav" });
    expect(sameOutputFor("pcm_s24le")).toEqual({ ext: "wav", mime: "audio/wav" });
    expect(sameOutputFor("pcm_s32le")).toEqual({ ext: "wav", mime: "audio/wav" });
    expect(sameOutputFor("pcm_alaw")).toEqual({ ext: "wav", mime: "audio/wav" });
    expect(sameOutputFor("pcm_mulaw")).toEqual({ ext: "wav", mime: "audio/wav" });
    expect(sameOutputFor("pcm_u8")).toEqual({ ext: "wav", mime: "audio/wav" });
  });

  it("sameOutputFor falls back to mka for unknown codecs and null", () => {
    expect(sameOutputFor("ac3")).toEqual(SAME_OUTPUT_FALLBACK);
    expect(sameOutputFor(null)).toEqual(SAME_OUTPUT_FALLBACK);
    expect(SAME_OUTPUT_FALLBACK).toEqual({ ext: "mka", mime: "audio/x-matroska" });
  });
});
