import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { LETTER_PORTRAIT, makeColumnContext, singleColumn } from "./_test-helpers";
import type { ColumnGeometry } from "./types";
import { bodyYBounds, markBlockDrawn, pageBreak, resetForColumn, wouldOverflow } from "./y-cursor";

describe("wouldOverflow", () => {
  it("false when block fits exactly inside the column", () => {
    const ctx = makeColumnContext({ yPt: 200, minYPt: 100 });
    // 100pt block: bottom would land on minYPt → fits.
    expect(wouldOverflow(ctx, 100)).toBe(false);
  });

  it("true when block bottom would fall below minYPt", () => {
    const ctx = makeColumnContext({ yPt: 200, minYPt: 100 });
    // 101pt block: bottom 99 < 100 → overflows.
    expect(wouldOverflow(ctx, 101)).toBe(true);
  });

  it("false for zero-height blocks", () => {
    const ctx = makeColumnContext({ yPt: 100, minYPt: 100 });
    expect(wouldOverflow(ctx, 0)).toBe(false);
  });

  it("tolerates sub-point floating-point underflow", () => {
    const ctx = makeColumnContext({ yPt: 200, minYPt: 100 });
    expect(wouldOverflow(ctx, 100 + 1e-9)).toBe(false);
  });
});

describe("markBlockDrawn", () => {
  it("decreases yPt by the drawn height", () => {
    const ctx = makeColumnContext({ yPt: 700 });
    markBlockDrawn(ctx, 30);
    expect(ctx.yPt).toBe(670);
  });

  it("sequential calls accumulate", () => {
    const ctx = makeColumnContext({ yPt: 700 });
    markBlockDrawn(ctx, 30);
    markBlockDrawn(ctx, 30);
    markBlockDrawn(ctx, 30);
    expect(ctx.yPt).toBe(610);
  });

  it("zero height is a no-op", () => {
    const ctx = makeColumnContext({ yPt: 700 });
    markBlockDrawn(ctx, 0);
    expect(ctx.yPt).toBe(700);
  });
});

describe("pageBreak", () => {
  it("adds a fresh page sized from pageGeometry and reseats ctx.page", async () => {
    const pdfDoc = await PDFDocument.create();
    const ctx = makeColumnContext({ yPt: 100 });
    const oldPage = ctx.page;
    const newPage = pageBreak(ctx, pdfDoc);
    expect(newPage).not.toBe(oldPage);
    expect(ctx.page).toBe(newPage);
    expect(pdfDoc.getPageCount()).toBe(1);
    const { width, height } = pdfDoc.getPage(0).getSize();
    expect(width).toBe(LETTER_PORTRAIT.widthPt);
    expect(height).toBe(LETTER_PORTRAIT.heightPt);
  });

  it("snaps yPt back to maxYPt", async () => {
    const pdfDoc = await PDFDocument.create();
    const ctx = makeColumnContext({ yPt: 100, maxYPt: 720 });
    pageBreak(ctx, pdfDoc);
    expect(ctx.yPt).toBe(720);
  });

  it("preserves column geometry across the break", async () => {
    const pdfDoc = await PDFDocument.create();
    const customCol: ColumnGeometry = { xPt: 100, widthPt: 200 };
    const ctx = makeColumnContext({ column: customCol, yPt: 50 });
    pageBreak(ctx, pdfDoc);
    expect(ctx.column).toEqual(customCol);
  });

  it("multiple page breaks all add pages", async () => {
    const pdfDoc = await PDFDocument.create();
    const ctx = makeColumnContext();
    pageBreak(ctx, pdfDoc);
    pageBreak(ctx, pdfDoc);
    pageBreak(ctx, pdfDoc);
    expect(pdfDoc.getPageCount()).toBe(3);
  });
});

describe("resetForColumn", () => {
  it("swaps the column geometry and snaps yPt to maxYPt", () => {
    const ctx = makeColumnContext({ yPt: 100, maxYPt: 720 });
    const colB: ColumnGeometry = { xPt: 320, widthPt: 250 };
    resetForColumn(ctx, colB);
    expect(ctx.column).toEqual(colB);
    expect(ctx.yPt).toBe(720);
  });

  it("does NOT reseat the page", () => {
    const ctx = makeColumnContext();
    const sameP = ctx.page;
    resetForColumn(ctx, { xPt: 0, widthPt: 100 });
    expect(ctx.page).toBe(sameP);
  });

  it("preserves pageGeometry, maxYPt, minYPt", () => {
    const ctx = makeColumnContext({ maxYPt: 700, minYPt: 60 });
    resetForColumn(ctx, { xPt: 320, widthPt: 250 });
    expect(ctx.pageGeometry).toBe(LETTER_PORTRAIT);
    expect(ctx.maxYPt).toBe(700);
    expect(ctx.minYPt).toBe(60);
  });
});

describe("bodyYBounds", () => {
  it("computes max/min from page height + margins", () => {
    expect(bodyYBounds(LETTER_PORTRAIT)).toEqual({
      maxYPt: 792 - 72,
      minYPt: 72,
    });
  });

  it("works for asymmetric margins", () => {
    const geo = {
      ...LETTER_PORTRAIT,
      marginTopPt: 100,
      marginBottomPt: 50,
    };
    expect(bodyYBounds(geo)).toEqual({ maxYPt: 692, minYPt: 50 });
  });
});

describe("singleColumn", () => {
  it("computes column width from page width minus side margins", () => {
    const col = singleColumn(LETTER_PORTRAIT);
    expect(col).toEqual({ xPt: 72, widthPt: 612 - 72 - 72 });
  });
});
