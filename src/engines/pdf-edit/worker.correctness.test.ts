import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type { PdfEditOptions } from "./options";
import { applyEdits } from "./worker";

const FIXTURE = path.resolve(__dirname, "../../../tests/fixtures/pdf-edit/multi-page.pdf");

function loadFixture(): Uint8Array {
  return new Uint8Array(readFileSync(FIXTURE));
}

describe("pdf-edit applyEdits — correctness", () => {
  it("rotates page 2, reorders 3 and 4, deletes page 5", async () => {
    const bytes = loadFixture();
    // Build the edit set: take pages [0, 1, 3, 2] with rotations [0, 90, 0, 0]
    // (i.e., delete the original page 4 (index 4), rotate page 2 (index 1) by
    // 90, swap pages 3 and 4 (indices 2 and 3)).
    const opts: PdfEditOptions = {
      pages: [
        { id: "a", sourceIndex: 0, rotation: 0 },
        { id: "b", sourceIndex: 1, rotation: 90 },
        { id: "c", sourceIndex: 3, rotation: 0 },
        { id: "d", sourceIndex: 2, rotation: 0 },
      ],
      totalSourcePages: 5,
    };
    const out = await applyEdits(bytes, opts);
    const outDoc = await PDFDocument.load(out);
    const outPages = outDoc.getPages();
    expect(outPages.length).toBe(4);

    // Source rotations: [0, 0, 90, 0, 0]
    // Edit: [{0,0}, {1,90}, {3,0}, {2,0}]
    // Expected composed rotations:
    //   page 0 source 0 + 0   = 0
    //   page 1 source 0 + 90  = 90
    //   page 3 source 0 + 0   = 0
    //   page 2 source 90 + 0  = 90
    expect(outPages[0]!.getRotation().angle).toBe(0);
    expect(outPages[1]!.getRotation().angle).toBe(90);
    expect(outPages[2]!.getRotation().angle).toBe(0);
    expect(outPages[3]!.getRotation().angle).toBe(90);
  });

  it("composes rotate-all with a pre-rotated source page", async () => {
    const bytes = loadFixture();
    // Take all 5 pages in order, each with user rotation 90°.
    const opts: PdfEditOptions = {
      pages: [
        { id: "a", sourceIndex: 0, rotation: 90 },
        { id: "b", sourceIndex: 1, rotation: 90 },
        { id: "c", sourceIndex: 2, rotation: 90 }, // source 90 + user 90 = 180
        { id: "d", sourceIndex: 3, rotation: 90 },
        { id: "e", sourceIndex: 4, rotation: 90 },
      ],
      totalSourcePages: 5,
    };
    const out = await applyEdits(bytes, opts);
    const outDoc = await PDFDocument.load(out);
    const outPages = outDoc.getPages();
    expect(outPages[0]!.getRotation().angle).toBe(90);
    expect(outPages[1]!.getRotation().angle).toBe(90);
    expect(outPages[2]!.getRotation().angle).toBe(180); // composition test
    expect(outPages[3]!.getRotation().angle).toBe(90);
    expect(outPages[4]!.getRotation().angle).toBe(90);
  });

  it("rejects empty edit set", async () => {
    const bytes = loadFixture();
    await expect(applyEdits(bytes, { pages: [], totalSourcePages: 5 })).rejects.toThrow(
      /at least one page/,
    );
  });

  it("rejects out-of-range sourceIndex", async () => {
    const bytes = loadFixture();
    await expect(
      applyEdits(bytes, {
        pages: [{ id: "a", sourceIndex: 99, rotation: 0 }],
        totalSourcePages: 5,
      }),
    ).rejects.toThrow(/out of range/);
  });
});

describe("pdf-edit worker — load + apply integration (regression)", () => {
  // Catches the ArrayBuffer-transfer detach bug: pre-fix, api.load()
  // passed `bytes` directly to loadPdfDocument, which calls pdf.js's
  // getDocument({ data: bytes }). pdf.js transfers the underlying
  // ArrayBuffer to its internal worker thread, detaching the original.
  // Since load() also stored `bytes` as sourceBytes, apply()'s subsequent
  // applyEdits(sourceBytes, opts) tried to construct from a detached
  // buffer and threw "Cannot perform Construct on a detached ArrayBuffer".
  //
  // We mock pdfjs-dist so that getDocument explicitly detaches whatever
  // buffer it receives — the same observable effect pdf.js produces — but
  // without requiring DOM APIs (DOMMatrix, OffscreenCanvas 2D, etc.) that
  // jsdom doesn't provide. applyEdits runs against real pdf-lib.
  //
  // Discriminator: pre-fix (bytes passed directly) → bytes is detached
  // after load() → apply() throws. Post-fix (bytes.slice(0) passed) →
  // bytes stays live → apply() returns a valid Uint8Array.
  it("apply() succeeds after load() has consumed the bytes", async () => {
    vi.resetModules();
    // Mock pdfjs-dist: simulate the transfer-detach of whatever buffer it
    // receives, return a minimal fake PDFDocumentProxy.
    vi.doMock("pdfjs-dist", () => ({
      GlobalWorkerOptions: { workerSrc: "" },
      getDocument: ({ data }: { data: ArrayBuffer | Uint8Array }) => ({
        promise: (async () => {
          // Transfer the input ArrayBuffer to a new Worker-like context,
          // detaching it — exactly what pdf.js does internally.
          const buf = data instanceof ArrayBuffer ? data : data.buffer;
          // structuredClone with transfer detaches buf in-place.
          structuredClone(buf, { transfer: [buf as ArrayBuffer] });
          return {
            numPages: 5,
            getPage: async () => ({}),
            destroy: async () => undefined,
          };
        })(),
      }),
    }));

    const workerModule = await import("./worker");
    const fixturePath = path.resolve(__dirname, "../../../tests/fixtures/pdf-edit/multi-page.pdf");
    const bytes = new Uint8Array(readFileSync(fixturePath)).buffer.slice(0);

    // Reproduce the canonical engine flow: load(bytes), then apply(opts).
    const { pageCount } = await workerModule.__apiForTest.load(bytes);
    expect(pageCount).toBe(5);

    // apply() calls applyEdits(sourceBytes, opts) with real pdf-lib.
    // Fails pre-fix (sourceBytes detached); succeeds post-fix.
    const out = await workerModule.__apiForTest.apply({
      pages: [
        { id: "a", sourceIndex: 0, rotation: 0 },
        { id: "b", sourceIndex: 1, rotation: 90 },
      ],
      totalSourcePages: 5,
    });
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBeGreaterThan(100);

    // Clean up so subsequent tests don't see leaked module-level state.
    await workerModule.__apiForTest.dispose();
    vi.doUnmock("pdfjs-dist");
  });
});
