import type { Paragraph, Run } from "@/engines/docx-to-pdf/docx-parser/types";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { type MockPage, makeColumnContext, makeMockPdfDoc } from "./_test-helpers";
import { layoutParagraph } from "./paragraph";

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

function makePara(runs: Run[], overrides: Partial<Paragraph> = {}): Paragraph {
  return {
    kind: "paragraph",
    alignment: "left",
    runs,
    ...overrides,
  };
}

async function freshDoc(): Promise<PDFDocument> {
  return PDFDocument.create();
}

/**
 * Locate the first `drawText` call on the mock page, asserting it
 * exists. Throws on absence so silent-pass tests can't mask a regression
 * (a `find` that returns `undefined` would otherwise let the assertion
 * block execute zero times).
 */
function firstDrawText(page: MockPage) {
  const c = page.__calls.find((cc) => cc.op === "drawText");
  expect(c).toBeDefined();
  if (c?.op !== "drawText") throw new Error("expected drawText call");
  return c;
}

describe("layoutParagraph — single line fit", () => {
  it("draws a one-run paragraph that fits on one line", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const p = makePara([makeRun({ text: "Hello world", fontSizePt: 11 })]);

    const result = layoutParagraph(p, ctx, pdf);
    expect(result.remainder).toBeUndefined();
    expect(result.drawnHeight).toBeCloseTo(11 * 1.2);
    expect(ctx.yPt).toBeCloseTo(700 - 11 * 1.2);
    const calls = (ctx.page as MockPage).__calls;
    const drawTextCalls = calls.filter((c) => c.op === "drawText");
    // Tokenizer emits "Hello", " ", "world" — three fragments.
    expect(drawTextCalls.map((c) => (c.op === "drawText" ? c.text : ""))).toEqual([
      "Hello",
      " ",
      "world",
    ]);
  });

  it("multi-run inline styling on one line emits one drawText per fragment", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const p = makePara([
      makeRun({ text: "Hello ", fontSizePt: 11 }),
      makeRun({ text: "bold", bold: true, fontSizePt: 11 }),
      makeRun({ text: " world", fontSizePt: 11 }),
    ]);

    const result = layoutParagraph(p, ctx, pdf);
    expect(result.remainder).toBeUndefined();
    const drawTextCalls = (ctx.page as MockPage).__calls.filter((c) => c.op === "drawText");
    // "Hello", " ", "bold", " ", "world" — depending on tokenization. The
    // exact count varies but at minimum we see >=3 fragments and the bold
    // word in the middle.
    expect(drawTextCalls.length).toBeGreaterThanOrEqual(3);
    const boldFragment = drawTextCalls.find((c) => c.op === "drawText" && c.text === "bold");
    expect(boldFragment).toBeDefined();
  });
});

describe("layoutParagraph — wrapping", () => {
  it("wraps a paragraph that exceeds a single line into multiple lines", async () => {
    const narrowCol = { xPt: 0, widthPt: 50 };
    const ctx = makeColumnContext({ yPt: 700, column: narrowCol });
    const pdf = await freshDoc();
    // Each word is ~5 chars * 11 * 0.55 = ~30pt, so 2 words ~60pt > 50pt.
    const p = makePara([makeRun({ text: "alpha beta gamma delta", fontSizePt: 11 })]);

    const result = layoutParagraph(p, ctx, pdf);
    expect(result.remainder).toBeUndefined();
    // Multiple lines drawn → drawnHeight is multiple of line-height.
    const lineH = 11 * 1.2;
    const lineCount = Math.round(result.drawnHeight / lineH);
    expect(lineCount).toBeGreaterThan(1);
  });

  it("forced \\n inside run.text creates a new line", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const p = makePara([makeRun({ text: "first\nsecond", fontSizePt: 11 })]);

    const result = layoutParagraph(p, ctx, pdf);
    expect(result.remainder).toBeUndefined();
    // Two lines.
    expect(result.drawnHeight).toBeCloseTo(2 * 11 * 1.2);
    // Check positions: 'first' drawn higher than 'second'.
    const calls = (ctx.page as MockPage).__calls.filter((c) => c.op === "drawText");
    const first = calls.find((c) => c.op === "drawText" && c.text === "first");
    const second = calls.find((c) => c.op === "drawText" && c.text === "second");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first?.op !== "drawText" || second?.op !== "drawText") throw new Error("expected drawText");
    expect(first.y).toBeGreaterThan(second.y);
  });

  it("a single word wider than the column is split char-by-char", async () => {
    const narrowCol = { xPt: 0, widthPt: 30 };
    const ctx = makeColumnContext({ yPt: 700, column: narrowCol });
    const pdf = await freshDoc();
    // 11pt * 0.55 per char = 6.05pt per char; 30pt / 6.05 ≈ 4 chars per line.
    const p = makePara([makeRun({ text: "abcdefghij", fontSizePt: 11 })]);

    const result = layoutParagraph(p, ctx, pdf);
    expect(result.remainder).toBeUndefined();
    const calls = (ctx.page as MockPage).__calls.filter((c) => c.op === "drawText");
    // The word should be split across multiple drawText calls.
    expect(calls.length).toBeGreaterThan(1);
    // Each fragment should fit within column width (30pt). Use the
    // mock-font width formula directly.
    for (const c of calls) {
      if (c.op === "drawText") {
        const w = c.text.length * c.size * 0.55;
        expect(w).toBeLessThanOrEqual(30 + 1e-6);
      }
    }
    // The fragments concatenate back to the original word.
    const reassembled = calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""))
      .join("");
    expect(reassembled).toBe("abcdefghij");
  });
});

describe("layoutParagraph — alignment", () => {
  it("center alignment offsets each line by (colWidth - lineWidth) / 2", async () => {
    const ctx = makeColumnContext({ yPt: 700, column: { xPt: 100, widthPt: 200 } });
    const pdf = await freshDoc();
    const p = makePara([makeRun({ text: "hi", fontSizePt: 10 })], { alignment: "center" });

    layoutParagraph(p, ctx, pdf);
    const calls = (ctx.page as MockPage).__calls.filter((c) => c.op === "drawText");
    // Single fragment "hi", width = 2 * 10 * 0.55 = 11. Slack 200 - 11 = 189.
    // Center offset = 189/2 = 94.5. x = 100 + 94.5 = 194.5.
    expect(calls).toHaveLength(1);
    const c = firstDrawText(ctx.page as MockPage);
    expect(c.x).toBeCloseTo(100 + (200 - 11) / 2);
  });

  it("right alignment offsets each line by (colWidth - lineWidth)", async () => {
    const ctx = makeColumnContext({ yPt: 700, column: { xPt: 100, widthPt: 200 } });
    const pdf = await freshDoc();
    const p = makePara([makeRun({ text: "hi", fontSizePt: 10 })], { alignment: "right" });

    layoutParagraph(p, ctx, pdf);
    const c = firstDrawText(ctx.page as MockPage);
    // x = colX + (colW - lineW) = 100 + 200 - 11 = 289
    expect(c.x).toBeCloseTo(100 + 200 - 11);
  });

  it("justify alignment falls back to left in v1", async () => {
    const ctx = makeColumnContext({ yPt: 700, column: { xPt: 100, widthPt: 200 } });
    const pdf = await freshDoc();
    const p = makePara([makeRun({ text: "hi", fontSizePt: 10 })], { alignment: "justify" });

    layoutParagraph(p, ctx, pdf);
    const c = firstDrawText(ctx.page as MockPage);
    expect(c.x).toBe(100);
  });

  it("left alignment is the default (no offset)", async () => {
    const ctx = makeColumnContext({ yPt: 700, column: { xPt: 100, widthPt: 200 } });
    const pdf = await freshDoc();
    const p = makePara([makeRun({ text: "hi", fontSizePt: 10 })]); // default left

    layoutParagraph(p, ctx, pdf);
    const c = firstDrawText(ctx.page as MockPage);
    expect(c.x).toBe(100);
  });
});

describe("layoutParagraph — heading scale", () => {
  it.each([
    ["Heading1", 24],
    ["Heading2", 20],
    ["Heading3", 16],
    ["Heading4", 14],
    ["Heading5", 13],
    ["Heading6", 12],
  ])("%s applies %i pt size when run has no explicit size", async (styleId, expectedSize) => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const p = makePara([makeRun({ text: "Title" })], { styleId });

    layoutParagraph(p, ctx, pdf);
    const c = firstDrawText(ctx.page as MockPage);
    expect(c.size).toBe(expectedSize);
  });

  it("heading forces bold via overrides.bold = true", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const p = makePara([makeRun({ text: "Title", bold: false })], { styleId: "Heading1" });
    layoutParagraph(p, ctx, pdf);
    const c = firstDrawText(ctx.page as MockPage);
    const f = c.font as unknown as { __label: string };
    expect(f.__label).toBe("inter-bold");
  });

  it("explicit run.fontSizePt overrides the heading default size", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const p = makePara([makeRun({ text: "Title", fontSizePt: 18 })], { styleId: "Heading1" });
    layoutParagraph(p, ctx, pdf);
    const c = firstDrawText(ctx.page as MockPage);
    expect(c.size).toBe(18);
  });

  it("non-heading style id is ignored", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const p = makePara([makeRun({ text: "Body" })], { styleId: "Normal" });
    layoutParagraph(p, ctx, pdf);
    const c = firstDrawText(ctx.page as MockPage);
    expect(c.size).toBe(11); // default body
  });
});

describe("layoutParagraph — empty paragraph", () => {
  it("draws a single blank line at default line-height", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const p = makePara([]);

    const result = layoutParagraph(p, ctx, pdf);
    expect(result.remainder).toBeUndefined();
    expect(result.drawnHeight).toBeCloseTo(11 * 1.2);
    expect((ctx.page as MockPage).__calls).toHaveLength(0); // nothing drawn
  });

  it("returns the paragraph itself as remainder when blank line doesn't fit", async () => {
    const ctx = makeColumnContext({ yPt: 100, minYPt: 99 });
    const pdf = await freshDoc();
    const p = makePara([]);
    const result = layoutParagraph(p, ctx, pdf);
    expect(result.remainder).toBe(p);
  });
});

describe("layoutParagraph — overflow remainder", () => {
  it("returns a remainder paragraph when column runs out of vertical space", async () => {
    // Tight column body so only one line fits.
    const ctx = makeColumnContext({ yPt: 100, minYPt: 80, column: { xPt: 0, widthPt: 50 } });
    const pdf = await freshDoc();
    // ~30pt per word at 11pt; force multiple lines so we run out.
    const p = makePara([makeRun({ text: "alpha beta gamma delta epsilon", fontSizePt: 11 })]);

    const result = layoutParagraph(p, ctx, pdf);
    expect(result.remainder).toBeDefined();
    expect(result.remainder?.runs.length).toBeGreaterThan(0);
    // Remainder should preserve alignment.
    expect(result.remainder?.alignment).toBe("left");
  });

  it("remainder text + drawn text reconstructs (modulo whitespace) the original", async () => {
    const ctx = makeColumnContext({ yPt: 100, minYPt: 80, column: { xPt: 0, widthPt: 50 } });
    const pdf = await freshDoc();
    const p = makePara([makeRun({ text: "alpha beta gamma delta", fontSizePt: 11 })]);

    const result = layoutParagraph(p, ctx, pdf);
    const drawn = (ctx.page as MockPage).__calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""))
      .join("");
    const remText = result.remainder?.runs.map((r) => r.text).join("") ?? "";
    // Strip whitespace for the comparison (line-end whitespace is dropped
    // and the tokenizer collapses tabs).
    expect((drawn + remText).replace(/\s/g, "")).toBe("alphabetagammadelta");
  });
});

describe("layoutParagraph — page break before run", () => {
  // These tests use a stub PDFDocument that returns mock pages so we can
  // inspect draw calls on the new page after a break. (Real PDFDocument
  // pages reject our mock fonts in drawText.)
  it("a run with pageBreakBefore triggers pageBreak and continues on a new page", () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = makeMockPdfDoc();
    const initialPage = ctx.page;
    const p = makePara([
      makeRun({ text: "before", fontSizePt: 11 }),
      makeRun({ text: "after", fontSizePt: 11, pageBreakBefore: true }),
    ]);

    const result = layoutParagraph(p, ctx, pdf as unknown as PDFDocument);
    expect(result.remainder).toBeUndefined();
    expect(pdf.__pages.length).toBe(1);
    // ctx.page got reseated to the freshly-added mock page.
    expect(ctx.page).not.toBe(initialPage);
    expect(ctx.page).toBe(pdf.__pages[0]);
    // ctx.yPt snapped back to maxYPt then descended once.
    expect(ctx.yPt).toBeLessThan(ctx.maxYPt);
  });

  it("draws 'before' on initial page and 'after' on the new page", () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = makeMockPdfDoc();
    const initialPage = ctx.page;
    const p = makePara([
      makeRun({ text: "before", fontSizePt: 11 }),
      makeRun({ text: "after", fontSizePt: 11, pageBreakBefore: true }),
    ]);
    layoutParagraph(p, ctx, pdf as unknown as PDFDocument);
    const initialDraws = (initialPage as MockPage).__calls;
    expect(initialDraws.some((c) => c.op === "drawText" && c.text === "before")).toBe(true);
    const newPageDraws = pdf.__pages[0]?.__calls ?? [];
    expect(newPageDraws.some((c) => c.op === "drawText" && c.text === "after")).toBe(true);
  });

  it("a run with columnBreakBefore also breaks (Task 7 routes to page break)", () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = makeMockPdfDoc();
    const initial = ctx.page;
    const p = makePara([
      makeRun({ text: "before", fontSizePt: 11 }),
      makeRun({ text: "after", fontSizePt: 11, columnBreakBefore: true }),
    ]);
    layoutParagraph(p, ctx, pdf as unknown as PDFDocument);
    expect(ctx.page).not.toBe(initial);
    expect(pdf.__pages.length).toBe(1);
  });

  it("pageBreakBefore on the first run still draws the first run on the new page", () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = makeMockPdfDoc();
    const initial = ctx.page;
    const p = makePara([makeRun({ text: "after", fontSizePt: 11, pageBreakBefore: true })]);

    layoutParagraph(p, ctx, pdf as unknown as PDFDocument);
    expect(ctx.page).not.toBe(initial);
    expect(pdf.__pages.length).toBe(1);
    const drew = (ctx.page as MockPage).__calls.some(
      (c) => c.op === "drawText" && c.text === "after",
    );
    expect(drew).toBe(true);
  });
});

describe("layoutParagraph — inline image runs (Task 7 stub)", () => {
  it("inline-image runs are skipped silently for Task 7 — no drawImage emitted", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const p = makePara([
      makeRun({ text: "before", fontSizePt: 11 }),
      makeRun({
        text: "",
        fontSizePt: 11,
        inlineImage: { rel: "rId1", widthPt: 100, heightPt: 100 },
      }),
      makeRun({ text: "after", fontSizePt: 11 }),
    ]);
    layoutParagraph(p, ctx, pdf);
    const calls = (ctx.page as MockPage).__calls;
    expect(calls.some((c) => c.op === "drawImage")).toBe(false);
    // Both text fragments still rendered.
    const texts = calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""));
    expect(texts).toContain("before");
    expect(texts).toContain("after");
  });
});

describe("layoutParagraph — line-height honors tallest run on the line", () => {
  it("when a 24pt run shares a line with an 11pt run, line-height = 24*1.2", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const p = makePara([
      makeRun({ text: "small ", fontSizePt: 11 }),
      makeRun({ text: "BIG", fontSizePt: 24 }),
    ]);
    const result = layoutParagraph(p, ctx, pdf);
    expect(result.drawnHeight).toBeCloseTo(24 * 1.2);
  });

  it("all fragments on a mixed-size line share one baseline", async () => {
    // Regression: each fragment used to draw at its own ascent
    // (`frag.heightPt * 0.8`) instead of the line's tallest-run ascent.
    // That made the 11 pt text float above the 24 pt baseline. The fix
    // hoists baselineY out of the loop and uses line.maxHeightPt.
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const p = makePara([
      makeRun({ text: "small ", fontSizePt: 11 }),
      makeRun({ text: "BIG", fontSizePt: 24 }),
    ]);
    layoutParagraph(p, ctx, pdf);
    const draws = (ctx.page as MockPage).__calls.filter((c) => c.op === "drawText");
    // Both fragments must draw at the same y.
    expect(draws.length).toBeGreaterThanOrEqual(2);
    const ys = draws.map((c) => (c.op === "drawText" ? c.y : 0));
    const allSameY = ys.every((y) => y === ys[0]);
    expect(allSameY).toBe(true);
  });
});

describe("layoutParagraph — re-break safety", () => {
  it("a pageBreakBefore run that overflows the new page returns a remainder without break flags", () => {
    // Regression: when a run's pageBreakBefore fires and the new page
    // also can't fit, the remainder used to spread the original run
    // (still flag-set), so the caller would re-fire pageBreak on
    // resume. Loop. The fix passes a stripped synth into
    // makeOverflowFromTail.
    const ctx = makeColumnContext({
      yPt: 100, // very little remaining body space
      maxYPt: 100, // new page also tiny
      minYPt: 50,
    });
    const pdf = makeMockPdfDoc();
    // Long oversized run with the break flag — guaranteed to overflow
    // the post-break page given the tiny min/max.
    const longText = "word ".repeat(200);
    const p = makePara([makeRun({ text: longText, fontSizePt: 11, pageBreakBefore: true })]);
    const result = layoutParagraph(p, ctx, pdf as unknown as PDFDocument);
    // The run is too long for the new page — expect a remainder.
    expect(result.remainder).toBeDefined();
    // The remainder's first run must NOT carry the break flag (else
    // resume would loop: pageBreak → overflow → remainder → pageBreak).
    const firstRun = result.remainder?.runs[0];
    expect(firstRun?.pageBreakBefore).not.toBe(true);
    expect(firstRun?.columnBreakBefore).not.toBe(true);
  });
});
