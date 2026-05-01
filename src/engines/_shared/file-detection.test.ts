import { describe, expect, it } from "vitest";
import { detectMime, extensionFromName } from "./file-detection";

function fileFromBytes(bytes: number[], name: string, mimeHint = ""): File {
  return new File([new Uint8Array(bytes)], name, { type: mimeHint });
}

describe("detectMime", () => {
  it("uses file.type when present and reliable", async () => {
    const f = fileFromBytes([0, 0, 0], "x.png", "image/png");
    expect(await detectMime(f)).toBe("image/png");
  });

  it("falls back to magic bytes when type is empty", async () => {
    const f = fileFromBytes([0xff, 0xd8, 0xff, 0xe0], "x", "");
    expect(await detectMime(f)).toBe("image/jpeg");
  });

  it("detects HEIC by ftyp box", async () => {
    const heicHeader = [0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63];
    const f = fileFromBytes(heicHeader, "photo.heic", "");
    expect(await detectMime(f)).toBe("image/heic");
  });

  it("detects PNG", async () => {
    const f = fileFromBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "x", "");
    expect(await detectMime(f)).toBe("image/png");
  });

  it("returns octet-stream for unknown bytes", async () => {
    const f = fileFromBytes([0x00, 0x01, 0x02, 0x03], "x", "");
    expect(await detectMime(f)).toBe("application/octet-stream");
  });
});

describe("extensionFromName", () => {
  it("extracts the lowercased extension", () => {
    expect(extensionFromName("photo.HEIC")).toBe("heic");
  });
  it("returns null when no extension", () => {
    expect(extensionFromName("README")).toBeNull();
  });
  it("returns null for trailing dot", () => {
    expect(extensionFromName("weird.")).toBeNull();
  });
  it("returns null for dotfiles", () => {
    expect(extensionFromName(".gitignore")).toBeNull();
  });
});
