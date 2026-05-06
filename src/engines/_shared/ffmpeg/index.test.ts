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

// jsdom does not define `crossOriginIsolated`. Each test installs the property
// at the top of the test and clears it in afterEach so no test leaks state
// into another — the loader memoizes its decision inside the singleton, so
// resetting both the singleton AND the global property is required.
function setCrossOriginIsolated(value: boolean): void {
  Object.defineProperty(globalThis, "crossOriginIsolated", {
    configurable: true,
    value,
  });
}

function clearCrossOriginIsolated(): void {
  // defineProperty (vs `delete`) avoids Biome's noDelete rule; vs plain
  // assignment, it sidesteps the read-only descriptor jsdom creates when
  // setCrossOriginIsolated installs the property without writable: true.
  Object.defineProperty(globalThis, "crossOriginIsolated", {
    configurable: true,
    value: undefined,
  });
}

afterEach(() => {
  __resetForTests();
  clearCrossOriginIsolated();
  vi.clearAllMocks();
});

describe("loadFfmpeg routing", () => {
  it("uses MT paths (with workerURL) when crossOriginIsolated === true", async () => {
    setCrossOriginIsolated(true);
    const ff = await loadFfmpeg();
    expect(ff.load).toHaveBeenCalledTimes(1);
    expect(ff.load).toHaveBeenCalledWith({
      coreURL: "/ffmpeg/mt/ffmpeg-core.js",
      wasmURL: "/ffmpeg/mt/ffmpeg-core.wasm",
      workerURL: "/ffmpeg/mt/ffmpeg-core.worker.js",
    });
  });

  it("uses ST paths (no workerURL) when crossOriginIsolated === false", async () => {
    setCrossOriginIsolated(false);
    const ff = await loadFfmpeg();
    expect(ff.load).toHaveBeenCalledTimes(1);
    expect(ff.load).toHaveBeenCalledWith({
      coreURL: "/ffmpeg/st/ffmpeg-core.js",
      wasmURL: "/ffmpeg/st/ffmpeg-core.wasm",
    });
  });

  it("uses ST paths when crossOriginIsolated is undefined", async () => {
    // No setCrossOriginIsolated call: the property is absent (default jsdom).
    const ff = await loadFfmpeg();
    expect(ff.load).toHaveBeenCalledWith({
      coreURL: "/ffmpeg/st/ffmpeg-core.js",
      wasmURL: "/ffmpeg/st/ffmpeg-core.wasm",
    });
  });
});

describe("loadFfmpeg memoization", () => {
  it("memoizes the instance across calls", async () => {
    setCrossOriginIsolated(true);
    const a = await loadFfmpeg();
    const b = await loadFfmpeg();
    expect(a).toBe(b);
    expect(FFmpeg).toHaveBeenCalledTimes(1);
  });

  it("resets the cached promise after a load failure so the next call retries", async () => {
    setCrossOriginIsolated(true);
    const FFmpegMock = FFmpeg as unknown as ReturnType<typeof vi.fn>;
    FFmpegMock.mockImplementationOnce(() => ({
      load: vi.fn().mockRejectedValue(new Error("net")),
      on: vi.fn(),
    }));
    await expect(loadFfmpeg()).rejects.toThrow("net");
    const ok = await loadFfmpeg();
    expect(ok).toBeDefined();
    expect(FFmpegMock).toHaveBeenCalledTimes(2);
  });
});
