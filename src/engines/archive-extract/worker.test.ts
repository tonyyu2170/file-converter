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
});
