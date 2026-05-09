import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type TarEntry, readTar, writeTar } from "./index";

const enc = new TextEncoder();

describe("_shared/tar round-trip", () => {
  it("write+read returns structurally equal entries", () => {
    const entries: TarEntry[] = [
      {
        path: "hello.txt",
        size: 6,
        mtime: 1700000000,
        type: "file",
        payload: enc.encode("hello\n"),
      },
      {
        path: "data/notes.md",
        size: 8,
        mtime: 1700000001,
        type: "file",
        payload: enc.encode("# notes\n"),
      },
    ];
    const buf = writeTar(entries);
    const read = readTar(buf);
    expect(read).toHaveLength(2);
    expect(read[0]?.path).toBe("hello.txt");
    expect(read[0]?.type).toBe("file");
    expect(new TextDecoder().decode(read[0]?.payload)).toBe("hello\n");
    expect(read[1]?.path).toBe("data/notes.md");
    expect(new TextDecoder().decode(read[1]?.payload)).toBe("# notes\n");
  });

  it("round-trips a single zero-length file", () => {
    const entries: TarEntry[] = [
      { path: "empty.txt", size: 0, mtime: 0, type: "file", payload: new Uint8Array() },
    ];
    const buf = writeTar(entries);
    const read = readTar(buf);
    expect(read).toHaveLength(1);
    expect(read[0]?.size).toBe(0);
    expect(read[0]?.payload).toHaveLength(0);
  });

  it("write throws on filename > 100 bytes", () => {
    const longPath = `${"a".repeat(101)}.txt`;
    expect(() =>
      writeTar([{ path: longPath, size: 0, mtime: 0, type: "file", payload: new Uint8Array() }]),
    ).toThrow(/> 100 bytes/);
  });

  it("payload sizes that aren't multiples of 512 round-trip with correct padding", () => {
    const entries: TarEntry[] = [
      {
        path: "odd.bin",
        size: 513,
        mtime: 0,
        type: "file",
        payload: new Uint8Array(513).fill(0xab),
      },
    ];
    const buf = writeTar(entries);
    expect(buf.length).toBe(512 + 1024 + 1024); // header + 2 padded blocks + 2 EOF
    const read = readTar(buf);
    expect(read[0]?.payload.length).toBe(513);
    expect(read[0]?.payload[512]).toBe(0xab);
  });
});

describe("_shared/tar read errors", () => {
  it("throws on bit-flipped header (checksum mismatch)", () => {
    const buf = writeTar([
      { path: "a.txt", size: 1, mtime: 0, type: "file", payload: enc.encode("X") },
    ]);
    // Flip one byte in the name field.
    const corrupted = new Uint8Array(buf);
    corrupted[0] = corrupted[0] === 0x61 ? 0x62 : 0x61;
    expect(() => readTar(corrupted)).toThrow(/checksum mismatch/);
  });

  it("throws when payload is truncated", () => {
    const buf = writeTar([
      { path: "a.bin", size: 100, mtime: 0, type: "file", payload: new Uint8Array(100).fill(0xab) },
    ]);
    // Cut off mid-payload.
    const truncated = buf.slice(0, 512 + 50);
    expect(() => readTar(truncated)).toThrow(/truncated/);
  });
});

describe("_shared/tar against tar(1) CLI fixture", () => {
  it("reads tar-cli-sample.tar (independent writer)", () => {
    const buf = new Uint8Array(
      readFileSync(path.resolve(__dirname, "../../../../tests/fixtures/archives/tar-cli-sample.tar")),
    );
    const entries = readTar(buf);
    const byName = new Map(entries.map((e) => [e.path, e]));
    const dec = new TextDecoder();
    expect(dec.decode(byName.get("hello.txt")?.payload)).toBe("hello\n");
    expect(dec.decode(byName.get("data/notes.md")?.payload)).toBe("# notes\n");
  });

  it("throws on tar-bad-checksum.tar", () => {
    const buf = new Uint8Array(
      readFileSync(path.resolve(__dirname, "../../../../tests/fixtures/archives/tar-bad-checksum.tar")),
    );
    expect(() => readTar(buf)).toThrow(/checksum mismatch/);
  });

  it("throws on tar-truncated.tar", () => {
    const buf = new Uint8Array(
      readFileSync(path.resolve(__dirname, "../../../../tests/fixtures/archives/tar-truncated.tar")),
    );
    expect(() => readTar(buf)).toThrow(/truncated/);
  });

  it("throws on tar-sparse.tar", () => {
    const buf = new Uint8Array(
      readFileSync(path.resolve(__dirname, "../../../../tests/fixtures/archives/tar-sparse.tar")),
    );
    expect(() => readTar(buf)).toThrow(/sparse/);
  });
});
