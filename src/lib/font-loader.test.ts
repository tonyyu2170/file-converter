import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetCache, loadFontBytes, resolveFilename } from "./font-loader";

describe("resolveFilename", () => {
  it.each([
    ["inter", 400, false, "inter-regular.ttf"],
    ["inter", 700, false, "inter-bold.ttf"],
    ["inter", 400, true, "inter-italic.ttf"],
    ["inter", 700, true, "inter-bold-italic.ttf"],
    ["lora", 400, false, "lora-regular.ttf"],
    ["lora", 700, false, "lora-bold.ttf"],
    ["lora", 400, true, "lora-italic.ttf"],
    ["lora", 700, true, "lora-bold-italic.ttf"],
    ["jetbrains-mono", 400, false, "jetbrains-mono-regular.ttf"],
    ["jetbrains-mono", 700, false, "jetbrains-mono-bold.ttf"],
  ] as const)("(%s, %i, italic=%s) → %s", (family, weight, italic, expected) => {
    expect(resolveFilename(family, weight, italic)).toBe(expected);
  });

  it("falls back to upright when JetBrains Mono italic is requested", () => {
    // No italic variants bundled for jetbrains-mono — italic flag is ignored.
    expect(resolveFilename("jetbrains-mono", 400, true)).toBe("jetbrains-mono-regular.ttf");
    expect(resolveFilename("jetbrains-mono", 700, true)).toBe("jetbrains-mono-bold.ttf");
  });
});

describe("loadFontBytes", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    _resetCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetCache();
  });

  it("fetches from /fonts/<filename> and returns bytes", async () => {
    const fakeBytes = new Uint8Array([0x00, 0x01, 0x00, 0x00]).buffer;
    const fetchMock = vi.fn().mockResolvedValue(new Response(fakeBytes, { status: 200 }));
    globalThis.fetch = fetchMock;

    const result = await loadFontBytes("inter", 400, false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/fonts/inter-regular.ttf");
    expect(result.byteLength).toBe(4);
  });

  it("caches the buffer so subsequent calls don't re-fetch", async () => {
    const fakeBytes = new Uint8Array([0x00, 0x01, 0x00, 0x00]).buffer;
    const fetchMock = vi.fn().mockResolvedValue(new Response(fakeBytes, { status: 200 }));
    globalThis.fetch = fetchMock;

    await loadFontBytes("inter", 400, false);
    await loadFontBytes("inter", 400, false);
    await loadFontBytes("inter", 400, false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caches per (family, weight, italic) key — different keys re-fetch", async () => {
    // Response bodies are single-consumption; mockImplementation returns a
    // fresh Response per call.
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(new Uint8Array([0x00]).buffer, { status: 200 })),
      );
    globalThis.fetch = fetchMock;

    await loadFontBytes("inter", 400, false);
    await loadFontBytes("inter", 700, false);
    await loadFontBytes("inter", 400, true);
    await loadFontBytes("lora", 400, false);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/fonts/inter-regular.ttf");
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/fonts/inter-bold.ttf");
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/fonts/inter-italic.ttf");
    expect(fetchMock).toHaveBeenNthCalledWith(4, "/fonts/lora-regular.ttf");
  });

  it("throws on non-OK response", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 404, statusText: "Not Found" }));
    await expect(loadFontBytes("inter", 400, false)).rejects.toThrow(/404/);
  });
});
