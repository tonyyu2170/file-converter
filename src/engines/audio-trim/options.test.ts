import { describe, expect, it } from "vitest";
import {
  AUDIO_TRIM_BITRATE_OPTIONS,
  AUDIO_TRIM_FORMATS,
  type AudioTrimOptions,
  defaultAudioTrimOptions,
  isLossyOutput,
  outputExtensionFor,
  outputMimeFor,
} from "./options";

describe("audio-trim options", () => {
  it("defaults outputFormat to 'same' so users get a fast lossless trim by default", () => {
    expect(defaultAudioTrimOptions.outputFormat).toBe("same");
  });

  it("defaults bitrate to 192", () => {
    expect(defaultAudioTrimOptions.bitrate).toBe(192);
  });

  it("defaults startSec=0, endSec=0", () => {
    expect(defaultAudioTrimOptions.startSec).toBe(0);
    expect(defaultAudioTrimOptions.endSec).toBe(0);
  });

  it("AUDIO_TRIM_FORMATS has same + four codecs in stable order", () => {
    expect(AUDIO_TRIM_FORMATS).toEqual(["same", "mp3", "wav", "m4a", "flac"]);
  });

  it("AUDIO_TRIM_BITRATE_OPTIONS matches the audio-convert set", () => {
    expect(AUDIO_TRIM_BITRATE_OPTIONS).toEqual([64, 128, 192, 256, 320]);
  });

  it("isLossyOutput is true for mp3/m4a, false for wav/flac, false for 'same'", () => {
    expect(isLossyOutput("mp3")).toBe(true);
    expect(isLossyOutput("m4a")).toBe(true);
    expect(isLossyOutput("wav")).toBe(false);
    expect(isLossyOutput("flac")).toBe(false);
    expect(isLossyOutput("same")).toBe(false);
  });

  it("outputExtensionFor returns the input extension when format is 'same'", () => {
    expect(outputExtensionFor("same", "song.mp3")).toBe("mp3");
    expect(outputExtensionFor("same", "TUNE.FLAC")).toBe("flac");
  });

  it("outputExtensionFor returns the format when format is concrete", () => {
    expect(outputExtensionFor("mp3", "anything.wav")).toBe("mp3");
    expect(outputExtensionFor("flac", "x.m4a")).toBe("flac");
  });

  it("outputMimeFor maps each format to a stable mime; 'same' uses the input mime", () => {
    expect(outputMimeFor("mp3", "audio/wav")).toBe("audio/mpeg");
    expect(outputMimeFor("wav", "audio/mpeg")).toBe("audio/wav");
    expect(outputMimeFor("flac", "audio/wav")).toBe("audio/flac");
    expect(outputMimeFor("m4a", "audio/wav")).toBe("audio/mp4");
    expect(outputMimeFor("same", "audio/mpeg")).toBe("audio/mpeg");
  });
});
