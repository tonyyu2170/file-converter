import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Test the worker's pure logic by importing it directly. We don't go through
// Comlink in unit tests — that's exercised in the E2E.
//
// To keep the worker module importable from a Node test context (it imports
// "comlink" and calls Comlink.expose at the bottom), we rely on the test runner
// not actually executing the side-effecting Comlink.expose in jsdom. Vitest +
// jsdom is fine here since `expose` only attaches a `message` listener to
// `globalThis`, which is harmless in tests.
import { extractArchive } from "./worker";

const FIX = path.resolve(__dirname, "../../../tests/fixtures/archives");
function readFix(name: string): Uint8Array<ArrayBuffer> {
  // readFileSync returns a Node Buffer that may be a slice of a shared pool.
  // Copy into a fresh ArrayBuffer so .buffer starts at offset 0.
  const nodeBuffer = readFileSync(path.join(FIX, name));
  const ab = nodeBuffer.buffer.slice(
    nodeBuffer.byteOffset,
    nodeBuffer.byteOffset + nodeBuffer.byteLength,
  ) as ArrayBuffer;
  return new Uint8Array(ab);
}

describe("archive-extract: happy paths", () => {
  it("extracts sample.zip", async () => {
    const out = await extractArchive(readFix("sample.zip").buffer, "sample.zip", "application/zip");
    expect(out.map((o) => o.filename).sort()).toEqual(["data/notes.md", "hello.txt"]);
    const hello = out.find((o) => o.filename === "hello.txt");
    expect(await hello?.blob.text()).toBe("hello\n");
  });

  it("extracts sample.tar", async () => {
    const out = await extractArchive(
      readFix("sample.tar").buffer,
      "sample.tar",
      "application/x-tar",
    );
    expect(out.map((o) => o.filename).sort()).toEqual(["data/notes.md", "hello.txt"]);
  });

  it("extracts sample.tar.gz", async () => {
    const out = await extractArchive(
      readFix("sample.tar.gz").buffer,
      "sample.tar.gz",
      "application/gzip",
    );
    expect(out.map((o) => o.filename).sort()).toEqual(["data/notes.md", "hello.txt"]);
  });
});

describe("archive-extract: rejections", () => {
  it("rejects encrypted ZIP", async () => {
    await expect(
      extractArchive(readFix("encrypted.zip").buffer, "encrypted.zip", "application/zip"),
    ).rejects.toThrow(/encrypted/);
  });

  it("rejects zip-slip", async () => {
    await expect(
      extractArchive(readFix("zip-slip.zip").buffer, "zip-slip.zip", "application/zip"),
    ).rejects.toThrow(/unsafe path/);
  });

  it("rejects > 1 GB single entry", async () => {
    await expect(
      extractArchive(readFix("huge-entry.zip").buffer, "huge-entry.zip", "application/zip"),
    ).rejects.toThrow(/would expand/);
  });

  it("rejects > 2 GB aggregate", async () => {
    await expect(
      extractArchive(readFix("bomb.zip").buffer, "bomb.zip", "application/zip"),
    ).rejects.toThrow(/expand/);
  });

  it("rejects bare .gz (no TAR inside)", async () => {
    await expect(
      extractArchive(readFix("bare.gz").buffer, "bare.gz", "application/gzip"),
    ).rejects.toThrow(/GZIP of non-TAR/);
  });

  it("rejects unknown format", async () => {
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]).buffer;
    await expect(extractArchive(garbage, "x.bin", "")).rejects.toThrow(/unrecognized/);
  });

  it("rejects path with backslash separator", async () => {
    // Hand-build a minimal ZIP with one entry named "..\\evil.txt" (Windows
    // path traversal payload). isSafePath should reject backslash separators.
    const enc = new TextEncoder();
    const name = enc.encode("..\\evil.txt");
    const data = enc.encode("x");
    // CRC-32 of "x"
    let crc = 0xffffffff;
    for (const b of data) {
      crc ^= b;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = new Uint8Array(30 + name.length + data.length);
    const ldv = new DataView(local.buffer);
    ldv.setUint32(0, 0x04034b50, true);
    ldv.setUint16(4, 20, true);
    ldv.setUint32(14, crc, true);
    ldv.setUint32(18, data.length, true);
    ldv.setUint32(22, data.length, true);
    ldv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);

    const central = new Uint8Array(46 + name.length);
    const cdv = new DataView(central.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, data.length, true);
    cdv.setUint32(24, data.length, true);
    cdv.setUint16(28, name.length, true);
    central.set(name, 46);

    const eocd = new Uint8Array(22);
    const edv = new DataView(eocd.buffer);
    edv.setUint32(0, 0x06054b50, true);
    edv.setUint16(8, 1, true);
    edv.setUint16(10, 1, true);
    edv.setUint32(12, central.length, true);
    edv.setUint32(16, local.length, true);

    const buf = new Uint8Array(local.length + central.length + eocd.length);
    buf.set(local, 0);
    buf.set(central, local.length);
    buf.set(eocd, local.length + central.length);

    await expect(
      extractArchive(buf.buffer as ArrayBuffer, "evil.zip", "application/zip"),
    ).rejects.toThrow(/unsafe path/);
  });
});
