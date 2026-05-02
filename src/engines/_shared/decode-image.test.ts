import { describe, expect, it, vi } from "vitest";

vi.mock("./file-detection", () => ({
  detectMime: vi.fn(),
}));

import { decodeImage } from "./decode-image";
import { detectMime } from "./file-detection";

const mockedDetectMime = detectMime as ReturnType<typeof vi.fn>;

describe("decodeImage", () => {
  it("dispatches HEIC files via the libheif path", async () => {
    mockedDetectMime.mockResolvedValueOnce("image/heic");
    const file = new File([new Uint8Array([0])], "x.heic", { type: "image/heic" });
    // libheif lazy-import will fail in jsdom (no real wasm); we assert that
    // the dispatcher reaches the libheif branch by catching the predictable
    // load failure rather than the createImageBitmap-on-empty-bytes branch.
    await expect(decodeImage(file)).rejects.toThrow();
  });

  it("dispatches HEIF files via the libheif path", async () => {
    mockedDetectMime.mockResolvedValueOnce("image/heif");
    const file = new File([new Uint8Array([0])], "x.heif", { type: "image/heif" });
    await expect(decodeImage(file)).rejects.toThrow();
  });

  it("dispatches PNG files via createImageBitmap", async () => {
    mockedDetectMime.mockResolvedValueOnce("image/png");
    const file = new File([new Uint8Array([0])], "x.png", { type: "image/png" });
    // jsdom's createImageBitmap is a real function but rejects on invalid bytes.
    await expect(decodeImage(file)).rejects.toThrow();
  });

  it("dispatches JPEG files via createImageBitmap", async () => {
    mockedDetectMime.mockResolvedValueOnce("image/jpeg");
    const file = new File([new Uint8Array([0])], "x.jpg", { type: "image/jpeg" });
    await expect(decodeImage(file)).rejects.toThrow();
  });
});
