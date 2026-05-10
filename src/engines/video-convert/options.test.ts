import { describe, expect, it } from "vitest";
import {
  CRF_BY_QUALITY,
  OUTPUT_EXTENSION,
  OUTPUT_MIME,
  VIDEO_CONVERT_FORMATS,
  VIDEO_CONVERT_QUALITY_LEVELS,
  audioCodec,
  defaultVideoConvertOptions,
  videoCodec,
} from "./options";

describe("video-convert options", () => {
  it("exposes the three target output formats in design order", () => {
    expect(VIDEO_CONVERT_FORMATS).toEqual(["mp4", "mov", "webm"]);
  });

  it("exposes the three quality levels in design order", () => {
    expect(VIDEO_CONVERT_QUALITY_LEVELS).toEqual(["low", "medium", "high"]);
  });

  it("maps quality levels to the spec-stated CRFs", () => {
    expect(CRF_BY_QUALITY.low).toBe(28);
    expect(CRF_BY_QUALITY.medium).toBe(23);
    expect(CRF_BY_QUALITY.high).toBe(18);
  });

  it("picks libx264 for mp4 and mov, libvpx-vp9 for webm", () => {
    expect(videoCodec("mp4")).toBe("libx264");
    expect(videoCodec("mov")).toBe("libx264");
    expect(videoCodec("webm")).toBe("libvpx-vp9");
  });

  it("picks aac for mp4/mov and libopus for webm", () => {
    expect(audioCodec("mp4")).toBe("aac");
    expect(audioCodec("mov")).toBe("aac");
    expect(audioCodec("webm")).toBe("libopus");
  });

  it("maps formats to canonical extensions and mimes", () => {
    expect(OUTPUT_EXTENSION.mp4).toBe("mp4");
    expect(OUTPUT_EXTENSION.mov).toBe("mov");
    expect(OUTPUT_EXTENSION.webm).toBe("webm");
    expect(OUTPUT_MIME.mp4).toBe("video/mp4");
    expect(OUTPUT_MIME.mov).toBe("video/quicktime");
    expect(OUTPUT_MIME.webm).toBe("video/webm");
  });

  it("defaults to outputFormat=null (force user choice) and quality=medium", () => {
    expect(defaultVideoConvertOptions.outputFormat).toBeNull();
    expect(defaultVideoConvertOptions.quality).toBe("medium");
  });
});
