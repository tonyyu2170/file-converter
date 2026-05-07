// src/engines/video-trim/options.test.ts
import { describe, expect, it } from "vitest";
import {
  containerSupportsCodecs,
  defaultVideoTrimOptions,
  outputExtensionFor,
  outputMimeFor,
  VIDEO_TRIM_CONTAINERS,
} from "./options";

describe("video-trim options", () => {
  it("default options use same-container, zero handles", () => {
    expect(defaultVideoTrimOptions).toEqual({
      startSec: 0,
      endSec: 0,
      containerFormat: "same",
    });
  });

  it("VIDEO_TRIM_CONTAINERS lists same/mp4/webm/mkv in order", () => {
    expect(VIDEO_TRIM_CONTAINERS).toEqual(["same", "mp4", "webm", "mkv"]);
  });

  it("outputExtensionFor 'same' preserves input extension", () => {
    expect(outputExtensionFor("same", "clip.mp4")).toBe("mp4");
    expect(outputExtensionFor("same", "clip.MOV")).toBe("mov");
    expect(outputExtensionFor("same", "clip.webm")).toBe("webm");
  });

  it("outputExtensionFor named containers returns the container as extension", () => {
    expect(outputExtensionFor("mp4", "x.webm")).toBe("mp4");
    expect(outputExtensionFor("webm", "x.mp4")).toBe("webm");
    expect(outputExtensionFor("mkv", "x.mov")).toBe("mkv");
  });

  it("outputMimeFor 'same' preserves input MIME", () => {
    expect(outputMimeFor("same", "video/quicktime")).toBe("video/quicktime");
    expect(outputMimeFor("same", "video/webm")).toBe("video/webm");
  });

  it("outputMimeFor named containers maps correctly", () => {
    expect(outputMimeFor("mp4", "video/webm")).toBe("video/mp4");
    expect(outputMimeFor("webm", "video/mp4")).toBe("video/webm");
    expect(outputMimeFor("mkv", "video/mp4")).toBe("video/x-matroska");
  });

  it("re-exports containerSupportsCodecs from _shared/ffmpeg", () => {
    expect(containerSupportsCodecs("mp4", "vp9", "aac")).toBe(false);
    expect(containerSupportsCodecs("same", "vp9", "opus")).toBe(true);
  });
});
