import { describe, expect, it } from "vitest";
import { containerSupportsCodecs } from "./codec-compat";

describe("containerSupportsCodecs", () => {
  it('"same" is always supported', () => {
    expect(containerSupportsCodecs("same", "vp9", "opus")).toBe(true);
    expect(containerSupportsCodecs("same", null, null)).toBe(true);
    expect(containerSupportsCodecs("same", "anything", "weird")).toBe(true);
  });

  it("MKV accepts everything", () => {
    expect(containerSupportsCodecs("mkv", "vp9", "opus")).toBe(true);
    expect(containerSupportsCodecs("mkv", "h264", "aac")).toBe(true);
    expect(containerSupportsCodecs("mkv", "ac3", null)).toBe(true);
  });

  it("MP4 accepts H.264/HEVC/AV1 video and AAC/MP3 audio", () => {
    expect(containerSupportsCodecs("mp4", "h264", "aac")).toBe(true);
    expect(containerSupportsCodecs("mp4", "hevc", "mp3")).toBe(true);
    expect(containerSupportsCodecs("mp4", "av1", "aac")).toBe(true);
  });

  it("MP4 rejects VP9 video and Opus audio", () => {
    expect(containerSupportsCodecs("mp4", "vp9", "aac")).toBe(false);
    expect(containerSupportsCodecs("mp4", "h264", "opus")).toBe(false);
    expect(containerSupportsCodecs("mp4", "vp9", "opus")).toBe(false);
  });

  it("WebM accepts VP8/VP9/AV1 video and Opus/Vorbis audio", () => {
    expect(containerSupportsCodecs("webm", "vp9", "opus")).toBe(true);
    expect(containerSupportsCodecs("webm", "vp8", "vorbis")).toBe(true);
    expect(containerSupportsCodecs("webm", "av1", "opus")).toBe(true);
  });

  it("WebM rejects H.264 video and AAC audio", () => {
    expect(containerSupportsCodecs("webm", "h264", "opus")).toBe(false);
    expect(containerSupportsCodecs("webm", "vp9", "aac")).toBe(false);
  });

  it("null codec on either side is treated as no constraint", () => {
    expect(containerSupportsCodecs("mp4", null, "aac")).toBe(true);
    expect(containerSupportsCodecs("mp4", "h264", null)).toBe(true);
    expect(containerSupportsCodecs("webm", null, null)).toBe(true);
  });
});
