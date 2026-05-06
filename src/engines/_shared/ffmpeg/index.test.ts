import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@ffmpeg/ffmpeg", () => {
  const FFmpegMock = vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { FFmpeg: FFmpegMock };
});

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { __resetForTests, loadFfmpeg } from "./index";

afterEach(() => {
  __resetForTests();
  vi.clearAllMocks();
});

describe("loadFfmpeg", () => {
  it("memoizes the instance across calls", async () => {
    const a = await loadFfmpeg();
    const b = await loadFfmpeg();
    expect(a).toBe(b);
    expect(FFmpeg).toHaveBeenCalledTimes(1);
  });

  it("calls FFmpeg.load with same-origin core + wasm URLs", async () => {
    const ff = await loadFfmpeg();
    expect(ff.load).toHaveBeenCalledWith(
      expect.objectContaining({
        coreURL: "/ffmpeg/ffmpeg-core.js",
        wasmURL: "/ffmpeg/ffmpeg-core.wasm",
      }),
    );
  });

  it("resets the cached promise after a load failure so the next call retries", async () => {
    const FFmpegMock = FFmpeg as unknown as ReturnType<typeof vi.fn>;
    FFmpegMock.mockImplementationOnce(() => ({
      load: vi.fn().mockRejectedValue(new Error("net")),
      on: vi.fn(),
    }));
    await expect(loadFfmpeg()).rejects.toThrow("net");
    // Second call should retry — new FFmpeg instance constructed.
    const ok = await loadFfmpeg();
    expect(ok).toBeDefined();
    expect(FFmpegMock).toHaveBeenCalledTimes(2);
  });
});
