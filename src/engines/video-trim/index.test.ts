// src/engines/video-trim/index.test.ts
import { describe, expect, it } from "vitest";
import engine from "./index";

describe("video-trim engine descriptor", () => {
  it("declares id 'video-trim' and category 'video'", () => {
    expect(engine.id).toBe("video-trim");
    expect(engine.category).toBe("video");
  });

  it("is single-cardinality", () => {
    expect(engine.cardinality).toBe("single");
  });

  it("accepts mp4, mov, webm, mkv extensions", () => {
    expect(engine.inputAccept).toEqual(expect.arrayContaining([".mp4", ".mov", ".webm", ".mkv"]));
  });

  it("validate accepts a 1 MB mp4 by MIME", () => {
    const file = new File([new Uint8Array(1_000_000)], "clip.mp4", {
      type: "video/mp4",
    });
    expect(engine.validate(file, engine.defaultOptions).ok).toBe(true);
  });

  it("validate accepts MOV / WebM / MKV by MIME", () => {
    expect(
      engine.validate(
        new File([new Uint8Array(1_000_000)], "x.mov", {
          type: "video/quicktime",
        }),
        engine.defaultOptions,
      ).ok,
    ).toBe(true);
    expect(
      engine.validate(
        new File([new Uint8Array(1_000_000)], "x.webm", {
          type: "video/webm",
        }),
        engine.defaultOptions,
      ).ok,
    ).toBe(true);
    expect(
      engine.validate(
        new File([new Uint8Array(1_000_000)], "x.mkv", {
          type: "video/x-matroska",
        }),
        engine.defaultOptions,
      ).ok,
    ).toBe(true);
  });

  it("validate falls back to extension when MIME is missing", () => {
    const file = new File([new Uint8Array(1)], "clip.mp4", { type: "" });
    expect(engine.validate(file, engine.defaultOptions).ok).toBe(true);
  });

  it("validate rejects an unsupported file type", () => {
    const file = new File([new Uint8Array(1)], "song.mp3", {
      type: "audio/mpeg",
    });
    const r = engine.validate(file, engine.defaultOptions);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/MP4, MOV, WebM, or MKV/);
  });

  it("validate rejects oversized files", () => {
    const file = new File([new Uint8Array([0])], "huge.mp4", {
      type: "video/mp4",
    });
    Object.defineProperty(file, "size", { value: 101 * 1024 * 1024 });
    const r = engine.validate(file, engine.defaultOptions);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/File too large/);
  });

  it("isReadyToConvert is false when end <= start", () => {
    expect(
      engine.isReadyToConvert?.({
        ...engine.defaultOptions,
        startSec: 5,
        endSec: 5,
      }),
    ).toBe(false);
    expect(
      engine.isReadyToConvert?.({
        ...engine.defaultOptions,
        startSec: 10,
        endSec: 5,
      }),
    ).toBe(false);
  });

  it("isReadyToConvert is false when range is shorter than 100 ms", () => {
    expect(
      engine.isReadyToConvert?.({
        ...engine.defaultOptions,
        startSec: 1.0,
        endSec: 1.05,
      }),
    ).toBe(false);
  });

  it("isReadyToConvert is true for a 1 s range", () => {
    expect(
      engine.isReadyToConvert?.({
        ...engine.defaultOptions,
        startSec: 1.0,
        endSec: 2.0,
      }),
    ).toBe(true);
  });

  it("OptionsPanel is wired", () => {
    expect(engine.OptionsPanel).toBeDefined();
  });
});
