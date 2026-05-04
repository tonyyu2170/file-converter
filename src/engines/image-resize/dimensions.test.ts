import { describe, expect, it } from "vitest";
import { MAX_DIMENSION, computeTargetDimensions, deriveOutput } from "./dimensions";

describe("computeTargetDimensions", () => {
  const source = { width: 1000, height: 500 };

  it("px mode, lock=false: uses width and height verbatim", () => {
    const target = computeTargetDimensions(source, {
      width: 200,
      height: 100,
      mode: "px",
      lockAspectRatio: false,
    });
    expect(target).toEqual({ width: 200, height: 100 });
  });

  it("px mode, lock=true: derives height from source aspect ratio", () => {
    const target = computeTargetDimensions(source, {
      width: 200,
      height: 999, // ignored when lock=true
      mode: "px",
      lockAspectRatio: true,
    });
    expect(target).toEqual({ width: 200, height: 100 });
  });

  it("percent mode, lock=false: scales each axis independently", () => {
    const target = computeTargetDimensions(source, {
      width: 50,
      height: 25,
      mode: "percent",
      lockAspectRatio: false,
    });
    expect(target).toEqual({ width: 500, height: 125 });
  });

  it("percent mode, lock=true: scales both axes by the width percent", () => {
    const target = computeTargetDimensions(source, {
      width: 50,
      height: 999, // ignored when lock=true
      mode: "percent",
      lockAspectRatio: true,
    });
    expect(target).toEqual({ width: 500, height: 250 });
  });

  it("rejects target < 1 on width", () => {
    expect(() =>
      computeTargetDimensions(source, {
        width: 0,
        height: 100,
        mode: "px",
        lockAspectRatio: false,
      }),
    ).toThrow(/too small/i);
  });

  it("rejects target < 1 on height (when lock=false)", () => {
    expect(() =>
      computeTargetDimensions(source, {
        width: 100,
        height: 0,
        mode: "px",
        lockAspectRatio: false,
      }),
    ).toThrow(/too small/i);
  });

  it("rejects target > MAX_DIMENSION", () => {
    expect(() =>
      computeTargetDimensions(source, {
        width: MAX_DIMENSION + 1,
        height: 100,
        mode: "px",
        lockAspectRatio: false,
      }),
    ).toThrow(/exceeds canvas limit/i);
  });
});

describe("deriveOutput", () => {
  const target = { width: 200, height: 100 };

  it("PNG input keeps PNG output with resolution suffix", () => {
    const out = deriveOutput("vacation.png", "image/png", target);
    expect(out).toEqual({
      filename: "vacation-200x100.png",
      mime: "image/png",
      ext: "png",
    });
  });

  it("JPEG input keeps JPEG output (.jpg extension)", () => {
    const out = deriveOutput("photo.jpeg", "image/jpeg", target);
    expect(out).toEqual({
      filename: "photo-200x100.jpg",
      mime: "image/jpeg",
      ext: "jpg",
    });
  });

  it("WebP input keeps WebP output", () => {
    const out = deriveOutput("art.webp", "image/webp", target);
    expect(out).toEqual({
      filename: "art-200x100.webp",
      mime: "image/webp",
      ext: "webp",
    });
  });

  it("HEIC input outputs PNG (extension swapped)", () => {
    const out = deriveOutput("img.heic", "image/heic", target);
    expect(out).toEqual({
      filename: "img-200x100.png",
      mime: "image/png",
      ext: "png",
    });
  });

  it("HEIF input outputs PNG", () => {
    const out = deriveOutput("img.heif", "image/heif", target);
    expect(out.mime).toBe("image/png");
    expect(out.filename).toMatch(/\.png$/);
  });

  it("Unknown MIME falls back to PNG", () => {
    const out = deriveOutput("mystery.bin", "application/octet-stream", target);
    expect(out.mime).toBe("image/png");
  });

  it("Filename without extension still works", () => {
    const out = deriveOutput("noext", "image/png", target);
    expect(out.filename).toBe("noext-200x100.png");
  });
});
