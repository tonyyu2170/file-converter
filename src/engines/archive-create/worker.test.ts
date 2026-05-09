import { readTar } from "@/engines/_shared/tar";
import { gunzipSync, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createArchive } from "./worker";

const enc = new TextEncoder();
const dec = new TextDecoder();

function toPayload(name: string, body: string): { bytes: ArrayBuffer; name: string; type: string } {
  const buf = enc.encode(body);
  // Wrap in a fresh ArrayBuffer to isolate from underlying Uint8Array buffer.
  const ab = buf.slice().buffer;
  return { bytes: ab, name, type: "text/plain" };
}

describe("archive-create: ZIP", () => {
  it("round-trips three files in StagingArea order", async () => {
    const out = await createArchive(
      [toPayload("a.txt", "AA"), toPayload("b.txt", "BB"), toPayload("c.txt", "CC")],
      { outputFormat: "zip", filename: "test" },
    );
    expect(out.filename).toBe("test.zip");
    const buf = new Uint8Array(await out.blob.arrayBuffer());
    const unzipped = unzipSync(buf);
    expect(Object.keys(unzipped).sort()).toEqual(["a.txt", "b.txt", "c.txt"]);
    const aBytes = unzipped["a.txt"];
    if (!aBytes) throw new Error("missing a.txt");
    expect(dec.decode(aBytes)).toBe("AA");
  });

  it("dedupes duplicate basenames", async () => {
    const out = await createArchive([toPayload("foo.png", "X"), toPayload("foo.png", "Y")], {
      outputFormat: "zip",
      filename: "dup",
    });
    const unzipped = unzipSync(new Uint8Array(await out.blob.arrayBuffer()));
    expect(Object.keys(unzipped).sort()).toEqual(["foo-1.png", "foo.png"]);
    const a = unzipped["foo.png"];
    const b = unzipped["foo-1.png"];
    if (!a || !b) throw new Error("missing dedup entries");
    expect(dec.decode(a)).toBe("X");
    expect(dec.decode(b)).toBe("Y");
  });
});

describe("archive-create: TAR.GZ", () => {
  it("round-trips three files", async () => {
    const out = await createArchive(
      [toPayload("a.txt", "AA"), toPayload("b.txt", "BB"), toPayload("c.txt", "CC")],
      { outputFormat: "tar.gz", filename: "test" },
    );
    expect(out.filename).toBe("test.tar.gz");
    const ungz = gunzipSync(new Uint8Array(await out.blob.arrayBuffer()));
    const entries = readTar(ungz);
    expect(entries.map((e) => e.path)).toEqual(["a.txt", "b.txt", "c.txt"]);
    const first = entries[0];
    if (!first) throw new Error("missing first entry");
    expect(dec.decode(first.payload)).toBe("AA");
  });
});
