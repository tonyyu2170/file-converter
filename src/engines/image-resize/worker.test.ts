/**
 * Worker logic tests — call api.convertSingle() directly, bypassing the
 * Worker boundary (jsdom has no Worker implementation). decodeImage is
 * mocked to return a fake ImageBitmap with known dimensions, since
 * createImageBitmap is stubbed to reject in the jsdom test environment.
 *
 * Actual pixel-dimension verification is deferred to the Playwright E2E
 * suite (Task 10).
 *
 * What IS verified here:
 *   - output filename pattern (-WxH suffix), including aspect-ratio lock
 *   - output MIME routing (HEIC → PNG, PNG → PNG)
 *   - percent-mode dimension calculation
 *   - rejection on out-of-range dimensions (0x0 too small)
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as decodeImageMod from "@/engines/_shared/decode-image";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock decodeImage so tests control the reported bitmap dimensions.
vi.mock("@/engines/_shared/decode-image");

// Import api AFTER setting up the mock so module resolution sees the spy.
const { api } = await import("./worker");

// Fake bitmap for a 1000×500 source image.
function fakeBitmap(width = 1000, height = 500) {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

// Helper: read a fixture as ArrayBuffer.
async function readFixtureBytes(filename: string): Promise<ArrayBuffer> {
  const filePath = path.resolve(__dirname, "../../../tests/fixtures", filename);
  const buf = await readFile(filePath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

describe("image-resize worker logic", () => {
  beforeEach(() => {
    vi.mocked(decodeImageMod.decodeImage).mockResolvedValue(fakeBitmap());
  });

  it("produces a -200x100 filename for px mode without aspect lock", async () => {
    const bytes = await readFixtureBytes("sample-1000x500.png");
    const result = await api.convertSingle(bytes, "sample-1000x500.png", "image/png", {
      width: 200,
      height: 100,
      mode: "px",
      lockAspectRatio: false,
    });
    expect(result.filename).toMatch(/-200x100\.png$/);
    expect(result.mime).toBe("image/png");
  });

  it("computes height from width when lockAspectRatio is on (1000x500 → width 200 → height 100)", async () => {
    const bytes = await readFixtureBytes("sample-1000x500.png");
    const result = await api.convertSingle(bytes, "sample-1000x500.png", "image/png", {
      width: 200,
      height: 999,
      mode: "px",
      lockAspectRatio: true,
    });
    // height = round(500 * 200 / 1000) = 100
    expect(result.filename).toMatch(/-200x100\.png$/);
  });

  it("computes correct dimensions in percent mode (50% of 1000x500 = 500x250)", async () => {
    const bytes = await readFixtureBytes("sample-1000x500.png");
    const result = await api.convertSingle(bytes, "sample-1000x500.png", "image/png", {
      width: 50,
      height: 50,
      mode: "percent",
      lockAspectRatio: false,
    });
    expect(result.filename).toMatch(/-500x250\.png$/);
  });

  it("routes HEIC input to PNG output MIME and swaps extension in filename", async () => {
    const bytes = await readFixtureBytes("sample.heic");
    const result = await api.convertSingle(bytes, "sample.heic", "image/heic", {
      width: 100,
      height: 100,
      mode: "px",
      lockAspectRatio: false,
    });
    expect(result.mime).toBe("image/png");
    expect(result.filename).toMatch(/\.png$/);
  });

  it("rejects when targetW and targetH are 0 (too small)", async () => {
    const bytes = await readFixtureBytes("sample-1000x500.png");
    await expect(
      api.convertSingle(bytes, "sample-1000x500.png", "image/png", {
        width: 0,
        height: 0,
        mode: "px",
        lockAspectRatio: false,
      }),
    ).rejects.toThrow(/too small/i);
  });
});
