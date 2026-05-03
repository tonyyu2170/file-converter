import type {
  NumberingDef,
  NumberingLevel,
  Paragraph,
  Run,
} from "@/engines/docx-to-pdf/docx-parser/types";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { type MockPage, makeColumnContext, makeMockPdfDoc } from "./_test-helpers";
import type { LayoutDeps } from "./block-dispatch";
import {
  LIST_INDENT_PER_LEVEL_PT,
  bumpCounter,
  computeMarkerText,
  createListState,
  formatCounterAs,
  layoutListItem,
  renderMarkerForLevel,
} from "./lists";

function makeRun(text: string, overrides: Partial<Run> = {}): Run {
  return {
    kind: "run",
    text,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    ...overrides,
  };
}

function makeListPara(
  text: string,
  numId: string,
  ilvl: number,
  overrides: Partial<Paragraph> = {},
): Paragraph {
  return {
    kind: "paragraph",
    alignment: "left",
    numPr: { numId, ilvl },
    runs: [makeRun(text, { fontSizePt: 11 })],
    ...overrides,
  };
}

function bulletDef(numId: string, glyph = "•"): NumberingDef {
  const levels = new Map<number, NumberingLevel>();
  for (let i = 0; i < 9; i++) {
    levels.set(i, { ilvl: i, format: "bullet", text: glyph });
  }
  return { numId, levels };
}

function decimalDef(numId: string): NumberingDef {
  const levels = new Map<number, NumberingLevel>();
  // Common Word convention: %1., %1.%2., %1.%2.%3., ...
  for (let i = 0; i < 9; i++) {
    const template = `${Array.from({ length: i + 1 }, (_, k) => `%${k + 1}`).join(".")}.`;
    levels.set(i, { ilvl: i, format: "decimal", text: template });
  }
  return { numId, levels };
}

function makeDeps(numbering: NumberingDef[] = []): LayoutDeps {
  const map = new Map<string, NumberingDef>();
  for (const d of numbering) map.set(d.numId, d);
  return {
    numbering: map,
    relationships: new Map(),
    listState: createListState(),
    warnings: [],
  };
}

async function freshDoc(): Promise<PDFDocument> {
  return PDFDocument.create();
}

/* ---------- Pure helpers ---------- */

describe("bumpCounter", () => {
  it("starts at 1 for a fresh (numId, ilvl)", () => {
    const s = createListState();
    expect(bumpCounter(s, "1", 0)).toBe(1);
  });

  it("increments on subsequent calls at same level", () => {
    const s = createListState();
    expect(bumpCounter(s, "1", 0)).toBe(1);
    expect(bumpCounter(s, "1", 0)).toBe(2);
    expect(bumpCounter(s, "1", 0)).toBe(3);
  });

  it("tracks separate counters per numId", () => {
    const s = createListState();
    expect(bumpCounter(s, "1", 0)).toBe(1);
    expect(bumpCounter(s, "2", 0)).toBe(1);
    expect(bumpCounter(s, "1", 0)).toBe(2);
  });

  it("tracks separate counters per ilvl within a numId", () => {
    const s = createListState();
    expect(bumpCounter(s, "1", 0)).toBe(1);
    expect(bumpCounter(s, "1", 1)).toBe(1);
    expect(bumpCounter(s, "1", 0)).toBe(2);
  });

  it("resets deeper levels when level decreases", () => {
    const s = createListState();
    bumpCounter(s, "1", 0); // L0=1
    bumpCounter(s, "1", 1); // L1=1
    bumpCounter(s, "1", 1); // L1=2
    expect(bumpCounter(s, "1", 0)).toBe(2); // back to L0 (=2)
    expect(bumpCounter(s, "1", 1)).toBe(1); // L1 reset to 1
  });
});

describe("formatCounterAs", () => {
  it.each([
    [1, "decimal", "1"],
    [42, "decimal", "42"],
    [1, "lowerLetter", "a"],
    [26, "lowerLetter", "z"],
    [27, "lowerLetter", "aa"],
    [1, "upperLetter", "A"],
    [26, "upperLetter", "Z"],
    [27, "upperLetter", "AA"],
    [1, "lowerRoman", "i"],
    [4, "lowerRoman", "iv"],
    [9, "lowerRoman", "ix"],
    [1, "upperRoman", "I"],
    [1990, "upperRoman", "MCMXC"],
    [3999, "upperRoman", "MMMCMXCIX"],
    [4000, "upperRoman", "4000"], // overflow → decimal fallback
  ] as const)("%d as %s → %s", (value, format, expected) => {
    expect(formatCounterAs(value, format)).toBe(expected);
  });

  it("bullet format returns the default bullet glyph", () => {
    expect(formatCounterAs(5, "bullet")).toBe("•");
  });
});

describe("computeMarkerText", () => {
  it("returns the level text for bullets", () => {
    const s = createListState();
    bumpCounter(s, "1", 0);
    const lvl: NumberingLevel = { ilvl: 0, format: "bullet", text: "•" };
    expect(computeMarkerText(lvl, s, "1", 0, 1)).toBe("•");
  });

  it("falls back to default bullet when level is undefined", () => {
    const s = createListState();
    expect(computeMarkerText(undefined, s, "1", 0, 1)).toBe("•");
  });

  it("substitutes %1 with the current decimal counter", () => {
    const s = createListState();
    bumpCounter(s, "1", 0); // counter at L0 = 1
    const lvl: NumberingLevel = { ilvl: 0, format: "decimal", text: "%1." };
    expect(computeMarkerText(lvl, s, "1", 0, 1)).toBe("1.");
  });

  it("substitutes %1.%2 with parent + current counters", () => {
    const s = createListState();
    bumpCounter(s, "1", 0); // L0 = 1
    bumpCounter(s, "1", 1); // L1 = 1
    const lvl: NumberingLevel = { ilvl: 1, format: "decimal", text: "%1.%2." };
    expect(computeMarkerText(lvl, s, "1", 1, 1)).toBe("1.1.");
  });
});

describe("renderMarkerForLevel", () => {
  it("renders a lowerLetter level using its own format", () => {
    const s = createListState();
    bumpCounter(s, "1", 0); // L0 = 1
    const lvl: NumberingLevel = { ilvl: 0, format: "lowerLetter", text: "%1)" };
    expect(renderMarkerForLevel(lvl, s, "1", 0, 1)).toBe("a)");
  });

  it("renders an upperRoman level for the third item", () => {
    const s = createListState();
    bumpCounter(s, "1", 0);
    bumpCounter(s, "1", 0);
    bumpCounter(s, "1", 0); // L0 = 3
    const lvl: NumberingLevel = { ilvl: 0, format: "upperRoman", text: "%1." };
    expect(renderMarkerForLevel(lvl, s, "1", 0, 3)).toBe("III.");
  });
});

/* ---------- layoutListItem integration ---------- */

describe("layoutListItem — bullet single level", () => {
  it("draws marker + body for one item", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const deps = makeDeps([bulletDef("1")]);
    const p = makeListPara("First item", "1", 0);
    const result = layoutListItem(p, ctx, pdf, deps);
    expect(result.remainder).toBeUndefined();
    const calls = (ctx.page as MockPage).__calls.filter((c) => c.op === "drawText");
    const texts = calls.map((c) => (c.op === "drawText" ? c.text : ""));
    expect(texts).toContain("•");
    expect(texts).toContain("First");
    expect(texts).toContain("item");
  });

  it("indents body by (ilvl + 1) * 24 pt", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const deps = makeDeps([bulletDef("1")]);
    const p = makeListPara("Body", "1", 0);
    layoutListItem(p, ctx, pdf, deps);
    const calls = (ctx.page as MockPage).__calls.filter((c) => c.op === "drawText");
    const bodyCall = calls.find((c) => c.op === "drawText" && c.text === "Body");
    expect(bodyCall).toBeDefined();
    if (bodyCall?.op !== "drawText") throw new Error("expected body call");
    // Body x should be at original column.x + 24 (ilvl=0 → 1 * 24).
    const expectedBodyX = 72 + LIST_INDENT_PER_LEVEL_PT;
    expect(bodyCall.x).toBeCloseTo(expectedBodyX);
  });

  it("draws nested bullets at progressively deeper indent", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const deps = makeDeps([bulletDef("1")]);
    layoutListItem(makeListPara("L0", "1", 0), ctx, pdf, deps);
    layoutListItem(makeListPara("L1", "1", 1), ctx, pdf, deps);
    layoutListItem(makeListPara("L2", "1", 2), ctx, pdf, deps);
    const drawTexts = (ctx.page as MockPage).__calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? { text: c.text, x: c.x } : { text: "", x: 0 }));
    const l0 = drawTexts.find((d) => d.text === "L0");
    const l1 = drawTexts.find((d) => d.text === "L1");
    const l2 = drawTexts.find((d) => d.text === "L2");
    expect(l0?.x).toBeCloseTo(72 + 24);
    expect(l1?.x).toBeCloseTo(72 + 48);
    expect(l2?.x).toBeCloseTo(72 + 72);
  });
});

describe("layoutListItem — decimal counters", () => {
  it("counter increments across consecutive items", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const deps = makeDeps([decimalDef("1")]);
    layoutListItem(makeListPara("A", "1", 0), ctx, pdf, deps);
    layoutListItem(makeListPara("B", "1", 0), ctx, pdf, deps);
    layoutListItem(makeListPara("C", "1", 0), ctx, pdf, deps);
    const texts = (ctx.page as MockPage).__calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""));
    expect(texts).toContain("1.");
    expect(texts).toContain("2.");
    expect(texts).toContain("3.");
  });

  it("nested level uses parent counter via %1.%2", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const deps = makeDeps([decimalDef("1")]);
    layoutListItem(makeListPara("L0a", "1", 0), ctx, pdf, deps); // 1.
    layoutListItem(makeListPara("L1a", "1", 1), ctx, pdf, deps); // 1.1.
    layoutListItem(makeListPara("L1b", "1", 1), ctx, pdf, deps); // 1.2.
    const texts = (ctx.page as MockPage).__calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""));
    expect(texts).toContain("1.");
    expect(texts).toContain("1.1.");
    expect(texts).toContain("1.2.");
  });

  it("counter resets on level decrease", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const deps = makeDeps([decimalDef("1")]);
    layoutListItem(makeListPara("L0a", "1", 0), ctx, pdf, deps); // 1.
    layoutListItem(makeListPara("L1a", "1", 1), ctx, pdf, deps); // 1.1.
    layoutListItem(makeListPara("L1b", "1", 1), ctx, pdf, deps); // 1.2.
    layoutListItem(makeListPara("L0b", "1", 0), ctx, pdf, deps); // 2.
    layoutListItem(makeListPara("L1c", "1", 1), ctx, pdf, deps); // 2.1.  (reset)
    const texts = (ctx.page as MockPage).__calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""));
    expect(texts).toContain("2.1.");
    expect(texts).not.toContain("2.3.");
  });
});

describe("layoutListItem — non-decimal formats render end-to-end", () => {
  function letterDef(numId: string, format: "lowerLetter" | "upperLetter"): NumberingDef {
    const levels = new Map<number, NumberingLevel>();
    levels.set(0, { ilvl: 0, format, text: "%1)" });
    return { numId, levels };
  }
  function romanDef(numId: string, format: "lowerRoman" | "upperRoman"): NumberingDef {
    const levels = new Map<number, NumberingLevel>();
    levels.set(0, { ilvl: 0, format, text: "%1." });
    return { numId, levels };
  }

  it("lowerLetter format renders 'a)', 'b)', 'c)'", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const deps = makeDeps([letterDef("1", "lowerLetter")]);
    layoutListItem(makeListPara("first", "1", 0), ctx, pdf, deps);
    layoutListItem(makeListPara("second", "1", 0), ctx, pdf, deps);
    layoutListItem(makeListPara("third", "1", 0), ctx, pdf, deps);
    const texts = (ctx.page as MockPage).__calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""));
    expect(texts).toContain("a)");
    expect(texts).toContain("b)");
    expect(texts).toContain("c)");
  });

  it("upperRoman format renders 'I.', 'II.', 'III.'", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const deps = makeDeps([romanDef("1", "upperRoman")]);
    layoutListItem(makeListPara("a", "1", 0), ctx, pdf, deps);
    layoutListItem(makeListPara("b", "1", 0), ctx, pdf, deps);
    layoutListItem(makeListPara("c", "1", 0), ctx, pdf, deps);
    const texts = (ctx.page as MockPage).__calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""));
    expect(texts).toContain("I.");
    expect(texts).toContain("II.");
    expect(texts).toContain("III.");
  });
});

describe("layoutListItem — mixed bullet and decimal", () => {
  it("renders bullets and decimals with their own formats independently", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const deps = makeDeps([bulletDef("1"), decimalDef("2")]);
    layoutListItem(makeListPara("Bullet", "1", 0), ctx, pdf, deps);
    layoutListItem(makeListPara("Number", "2", 0), ctx, pdf, deps);
    const texts = (ctx.page as MockPage).__calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""));
    expect(texts).toContain("•");
    expect(texts).toContain("1.");
  });
});

describe("layoutListItem — continuation across page boundary", () => {
  it("advances to a new page when body overflows; does not redraw marker", async () => {
    // Squeeze the column so a long body needs a continuation.
    const ctx = makeColumnContext({ yPt: 100, minYPt: 50, maxYPt: 700 });
    const originalPage = ctx.page as MockPage; // capture before pageBreak swaps
    const pdfDoc = makeMockPdfDoc();
    // Use the mock pdf doc; pageBreak adds new MockPages tracked via __pages.
    const pdf = pdfDoc as unknown as PDFDocument;
    const deps = makeDeps([bulletDef("1")]);
    // Long text — many words, must wrap onto > 3 lines so it overflows.
    const longText = Array(120).fill("word").join(" ");
    const p = makeListPara(longText, "1", 0);
    const result = layoutListItem(p, ctx, pdf, deps);
    expect(result.remainder).toBeUndefined();
    expect(pdfDoc.__pages.length).toBeGreaterThanOrEqual(1);
    // Aggregate draw calls from ALL pages — the original (pre-pageBreak)
    // and every page added via pageBreak. ctx.page now points at the
    // most-recent post-break page; we need originalPage too.
    const allCalls = [...originalPage.__calls, ...pdfDoc.__pages.flatMap((mp) => mp.__calls)];
    // Marker should appear EXACTLY once across all pages.
    const markers = allCalls.filter((c) => c.op === "drawText" && c.text === "•");
    expect(markers.length).toBe(1);
  });
});

describe("layoutListItem — defensive paths", () => {
  it("falls back to default bullet when numbering def is missing", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const deps = makeDeps(); // empty
    layoutListItem(makeListPara("Lonely", "missing", 0), ctx, pdf, deps);
    const texts = (ctx.page as MockPage).__calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""));
    expect(texts).toContain("•");
  });

  it("falls back to default bullet when level def is missing", async () => {
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const incomplete: NumberingDef = { numId: "1", levels: new Map() };
    const deps = makeDeps([incomplete]);
    layoutListItem(makeListPara("X", "1", 5), ctx, pdf, deps);
    const texts = (ctx.page as MockPage).__calls
      .filter((c) => c.op === "drawText")
      .map((c) => (c.op === "drawText" ? c.text : ""));
    expect(texts).toContain("•");
  });

  it("returns paragraph as remainder when no room for first line", async () => {
    // yPt < minYPt + line height → can't fit even the marker line.
    const ctx = makeColumnContext({ yPt: 51, minYPt: 50, maxYPt: 700 });
    const pdf = await freshDoc();
    const deps = makeDeps([bulletDef("1")]);
    const result = layoutListItem(makeListPara("X", "1", 0), ctx, pdf, deps);
    expect(result.remainder).toBeDefined();
  });

  it("does not bump counter when level definition is missing", async () => {
    // numId is registered but ilvl=5 has no level definition. The
    // default-bullet fallback renders, but ListState counters MUST NOT
    // advance for the phantom level — silently bumping would corrupt
    // any later paragraph that references a sibling level under the
    // same numId, or any downstream tooling reading ListState.
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const incomplete: NumberingDef = { numId: "1", levels: new Map() };
    const deps = makeDeps([incomplete]);
    layoutListItem(makeListPara("Phantom", "1", 5), ctx, pdf, deps);
    // No counters should be tracked for numId "1" at all — bumpCounter
    // was never called, so neither the counters Map nor the lastLevel
    // Map gained an entry for it.
    expect(deps.listState.counters.get("1")).toBeUndefined();
    expect(deps.listState.lastLevel.get("1")).toBeUndefined();
  });

  it("does not bump counter when numId is unknown", async () => {
    // numId entirely missing from the numbering map. Default-bullet
    // fallback renders; counters stay untouched.
    const ctx = makeColumnContext({ yPt: 700 });
    const pdf = await freshDoc();
    const deps = makeDeps(); // empty numbering map
    layoutListItem(makeListPara("Lonely", "missing", 0), ctx, pdf, deps);
    expect(deps.listState.counters.size).toBe(0);
    expect(deps.listState.lastLevel.size).toBe(0);
  });
});
