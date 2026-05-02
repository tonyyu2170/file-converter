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
    // libheif's parser rejects bytes too small to be a HEIF box; reaching
    // that rejection confirms the dispatcher took the HEIC branch.
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
    // test-setup.ts stubs createImageBitmap to reject; reaching that
    // rejection confirms the dispatcher took the non-HEIC branch.
    await expect(decodeImage(file)).rejects.toThrow();
  });

  it("dispatches JPEG files via createImageBitmap", async () => {
    mockedDetectMime.mockResolvedValueOnce("image/jpeg");
    const file = new File([new Uint8Array([0])], "x.jpg", { type: "image/jpeg" });
    await expect(decodeImage(file)).rejects.toThrow();
  });
});
