import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MediaAsset, Run } from "@/engines/docx-to-pdf/docx-parser/types";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { type MockPage, makeColumnContext } from "./_test-helpers";
import { drawInlineImage, embedInlineImage, fitImageToColumn, sniffImageFormat } from "./images";

function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(__dirname, "../../../../tests/fixtures", name)));
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    kind: "run",
    text: "",
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    ...overrides,
  };
}

function makeMedia(
  bytes: Uint8Array,
  path = "word/media/img.bin",
  mime = "application/octet-stream",
): MediaAsset {
  return { path, mime, bytes };
}

describe("sniffImageFormat", () => {
  it("recognizes PNG signature", () => {
    expect(sniffImageFormat(loadFixture("sample.png"))).toBe("png");
  });

  it("recognizes JPEG signature", () => {
    expect(sniffImageFormat(loadFixture("sample.jpg"))).toBe("jpeg");
  });

  it("returns 'unknown' for non-image bytes", () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
    expect(sniffImageFormat(bytes)).toBe("unknown");
  });

  it("returns 'unknown' for an empty buffer", () => {
    expect(sniffImageFormat(new Uint8Array(0))).toBe("unknown");
  });

  it("returns 'unknown' for a near-PNG signature", () => {
    // 89 50 4E 47 ... but with the wrong second tetrad.
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]);
    expect(sniffImageFormat(bytes)).toBe("unknown");
  });
});

describe("embedInlineImage", () => {
  it("embeds a PNG via PDFDocument.embedPng", async () => {
    const pdf = await PDFDocument.create();
    const media = makeMedia(loadFixture("sample.png"), "word/media/image1.png", "image/png");
    const img = await embedInlineImage(media, pdf);
    // pdf-lib PDFImage exposes `.width` and `.height` in pixels.
    expect(img.width).toBeGreaterThan(0);
    expect(img.height).toBeGreaterThan(0);
  });

  it("embeds a JPEG via PDFDocument.embedJpg", async () => {
    const pdf = await PDFDocument.create();
    const media = makeMedia(loadFixture("sample.jpg"), "word/media/image1.jpg", "image/jpeg");
    const img = await embedInlineImage(media, pdf);
    expect(img.width).toBeGreaterThan(0);
    expect(img.height).toBeGreaterThan(0);
  });

  it("throws for an unsupported format", async () => {
    const pdf = await PDFDocument.create();
    const media = makeMedia(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    await expect(embedInlineImage(media, pdf)).rejects.toThrow(/unsupported/);
  });
});

describe("fitImageToColumn", () => {
  it("keeps the desired size when it fits the column", () => {
    const ctx = makeColumnContext();
    const result = fitImageToColumn(200, 150, ctx);
    expect(result).toEqual({
      widthPt: 200,
      heightPt: 150,
      shrunk: false,
      overshrunk: false,
    });
  });

  it("shrinks proportionally when wider than the column", () => {
    const ctx = makeColumnContext();
    const colWidth = ctx.column.widthPt; // 612 - 144 = 468 for letter portrait
    const result = fitImageToColumn(colWidth * 2, colWidth * 1, ctx);
    expect(result.shrunk).toBe(true);
    expect(result.widthPt).toBeCloseTo(colWidth);
    // height scales with the same ratio (½), so ≈ colWidth/2
    expect(result.heightPt).toBeCloseTo(colWidth / 2);
  });

  it("flags overshrunk when resulting height >= 50% of column body height", () => {
    const ctx = makeColumnContext({ maxYPt: 700, minYPt: 100 }); // body 600pt
    const result = fitImageToColumn(100, 400, ctx); // fits width; height = 400 > 300
    expect(result.overshrunk).toBe(true);
  });

  it("does not flag overshrunk for normal-height images", () => {
    const ctx = makeColumnContext({ maxYPt: 700, minYPt: 100 }); // body 600pt
    const result = fitImageToColumn(100, 100, ctx);
    expect(result.overshrunk).toBe(false);
  });

  it("returns zeros for non-positive dimensions", () => {
    const ctx = makeColumnContext();
    expect(fitImageToColumn(0, 100, ctx)).toEqual({
      widthPt: 0,
      heightPt: 0,
      shrunk: false,
      overshrunk: false,
    });
    expect(fitImageToColumn(100, -1, ctx)).toEqual({
      widthPt: 0,
      heightPt: 0,
      shrunk: false,
      overshrunk: false,
    });
  });

  it("preserves aspect ratio in the shrunk case", () => {
    const ctx = makeColumnContext();
    const colWidth = ctx.column.widthPt;
    const result = fitImageToColumn(colWidth * 4, colWidth * 3, ctx);
    expect(result.widthPt / result.heightPt).toBeCloseTo(4 / 3);
  });
});

describe("drawInlineImage", () => {
  it("emits a single drawImage with correct geometry (top-left → bottom-left offset)", async () => {
    const pdf = await PDFDocument.create();
    const media = makeMedia(loadFixture("sample.png"), "word/media/image1.png", "image/png");
    const img = await embedInlineImage(media, pdf);

    const ctx = makeColumnContext();
    const run = makeRun({ inlineImage: { rel: "rId7", widthPt: 100, heightPt: 80 } });
    const result = drawInlineImage(ctx, img, run, 50, 700);
    expect(result.widthPt).toBe(100);
    expect(result.heightPt).toBe(80);
    expect(result.shrunk).toBe(false);

    const calls = (ctx.page as MockPage).__calls;
    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (call?.op !== "drawImage") throw new Error("expected drawImage");
    expect(call.x).toBe(50);
    expect(call.y).toBe(700 - 80); // top-left semantic translated to bottom-left
    expect(call.width).toBe(100);
    expect(call.height).toBe(80);
  });

  it("does nothing when run.inlineImage is undefined", async () => {
    const pdf = await PDFDocument.create();
    const media = makeMedia(loadFixture("sample.png"));
    const img = await embedInlineImage(media, pdf);
    const ctx = makeColumnContext();
    const run = makeRun(); // no inlineImage
    const result = drawInlineImage(ctx, img, run, 0, 0);
    expect(result.widthPt).toBe(0);
    expect((ctx.page as MockPage).__calls).toHaveLength(0);
  });

  it("applies shrink-to-fit when the desired width exceeds the column", async () => {
    const pdf = await PDFDocument.create();
    const media = makeMedia(loadFixture("sample.png"));
    const img = await embedInlineImage(media, pdf);
    const ctx = makeColumnContext();
    const colWidth = ctx.column.widthPt;
    const run = makeRun({
      inlineImage: { rel: "rId1", widthPt: colWidth * 2, heightPt: colWidth },
    });
    const result = drawInlineImage(ctx, img, run, ctx.column.xPt, 700);
    expect(result.shrunk).toBe(true);
    expect(result.widthPt).toBeCloseTo(colWidth);
    expect(result.heightPt).toBeCloseTo(colWidth / 2);
    const call = (ctx.page as MockPage).__calls[0];
    if (call?.op !== "drawImage") throw new Error("expected drawImage");
    expect(call.width).toBeCloseTo(colWidth);
  });
});
