import type { Run } from "@/engines/_shared/docx/docx-parser/types";
import { describe, expect, it } from "vitest";
import { type MockPage, makeColumnContext, makeMockEmbeddedFonts } from "./_test-helpers";
import {
  DEFAULT_FONT_SIZE_PT,
  decorationThickness,
  drawRunSpan,
  measureFragment,
  measureRun,
  parseColorHex,
  pickRunFont,
  runFontSizePt,
} from "./runs";

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    kind: "run",
    text: "hello",
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    ...overrides,
  };
}

describe("runFontSizePt", () => {
  it("returns explicit fontSizePt when set", () => {
    expect(runFontSizePt(makeRun({ fontSizePt: 14 }))).toBe(14);
  });

  it("falls back to DEFAULT_FONT_SIZE_PT when undefined", () => {
    expect(runFontSizePt(makeRun())).toBe(DEFAULT_FONT_SIZE_PT);
  });
});

describe("pickRunFont — substitution and slot resolution", () => {
  const fonts = makeMockEmbeddedFonts();

  it.each([
    ["Calibri", false, false, "inter-regular"],
    ["Calibri", true, false, "inter-bold"],
    ["Calibri", false, true, "inter-italic"],
    ["Calibri", true, true, "inter-bold-italic"],
    ["Cambria", false, false, "lora-regular"],
    ["Cambria", true, true, "lora-bold-italic"],
    ["Times New Roman", true, false, "lora-bold"],
    ["Consolas", false, false, "jetbrains-mono-regular"],
    ["Consolas", true, false, "jetbrains-mono-bold"],
    [undefined, false, false, "inter-regular"], // default sub
  ] as const)("%s bold=%s italic=%s → %s", (fontFamily, bold, italic, expectedLabel) => {
    const run = makeRun({
      ...(fontFamily !== undefined && { fontFamily }),
      bold,
      italic,
    });
    const f = pickRunFont(run, fonts) as unknown as { __label: string };
    expect(f.__label).toBe(expectedLabel);
  });

  it("JetBrains Mono italic falls back to upright per weight", () => {
    const fontsLocal = makeMockEmbeddedFonts();
    const regular = pickRunFont(
      makeRun({ fontFamily: "Courier New", italic: true }),
      fontsLocal,
    ) as unknown as { __label: string };
    const bold = pickRunFont(
      makeRun({ fontFamily: "Courier New", bold: true, italic: true }),
      fontsLocal,
    ) as unknown as { __label: string };
    expect(regular.__label).toBe("jetbrains-mono-regular");
    expect(bold.__label).toBe("jetbrains-mono-bold");
  });

  it("overrides.bold supersedes run.bold (heading scenario)", () => {
    const f = pickRunFont(makeRun({ bold: false }), makeMockEmbeddedFonts(), {
      bold: true,
    }) as unknown as { __label: string };
    expect(f.__label).toBe("inter-bold");
  });

  it("overrides.italic supersedes run.italic", () => {
    const f = pickRunFont(makeRun({ italic: false }), makeMockEmbeddedFonts(), {
      italic: true,
    }) as unknown as { __label: string };
    expect(f.__label).toBe("inter-italic");
  });
});

describe("measureRun", () => {
  const fonts = makeMockEmbeddedFonts();

  it("returns width per mock formula and height = size * 1.2", () => {
    const run = makeRun({ text: "hi", fontSizePt: 10 });
    const m = measureRun(run, fonts);
    expect(m.widthPt).toBeCloseTo(2 * 10 * 0.55);
    expect(m.heightPt).toBeCloseTo(10 * 1.2);
  });

  it("scales with explicit fontSizePt", () => {
    const run = makeRun({ text: "hi", fontSizePt: 24 });
    const m = measureRun(run, fonts);
    expect(m.widthPt).toBeCloseTo(2 * 24 * 0.55);
    expect(m.heightPt).toBeCloseTo(24 * 1.2);
  });

  it("size override beats run.fontSizePt", () => {
    const run = makeRun({ text: "hi", fontSizePt: 10 });
    const m = measureRun(run, fonts, { sizePt: 20 });
    expect(m.widthPt).toBeCloseTo(2 * 20 * 0.55);
  });

  it("bold override picks the bold slot before measuring", () => {
    const run = makeRun({ text: "x", fontFamily: "Calibri" });
    measureRun(run, fonts, { bold: true });
    // Indirect assertion: pickRunFont under bold:true returns the bold slot;
    // measureRun's width is just font.widthOfTextAtSize. The mock doesn't
    // distinguish — so we assert by re-picking and checking labels match.
    const f = pickRunFont(run, fonts, { bold: true }) as unknown as { __label: string };
    expect(f.__label).toBe("inter-bold");
  });
});

describe("measureFragment", () => {
  it("measures arbitrary substrings independent of run.text", () => {
    const fonts = makeMockEmbeddedFonts();
    const run = makeRun({ text: "ignored", fontSizePt: 12 });
    const w = measureFragment("Hello", run, fonts);
    expect(w).toBeCloseTo(5 * 12 * 0.55);
  });
});

describe("drawRunSpan", () => {
  it("emits a single drawText with x, y, size, font", () => {
    const ctx = makeColumnContext();
    const run = makeRun({ text: "hi", fontSizePt: 10 });
    const advance = drawRunSpan(ctx, run, "hi", 100, 200);
    const calls = (ctx.page as MockPage).__calls;
    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (call?.op !== "drawText") throw new Error("expected drawText");
    expect(call.text).toBe("hi");
    expect(call.x).toBe(100);
    expect(call.y).toBe(200);
    expect(call.size).toBe(10);
    expect(advance).toBeCloseTo(2 * 10 * 0.55);
  });

  it("draws underline as a line below the baseline when run.underline", () => {
    const ctx = makeColumnContext();
    const run = makeRun({ text: "hi", underline: true, fontSizePt: 10 });
    drawRunSpan(ctx, run, "hi", 100, 200);
    const ops = (ctx.page as MockPage).__calls.map((c) => c.op);
    expect(ops).toEqual(["drawText", "drawLine"]);
    const line = (ctx.page as MockPage).__calls[1];
    if (line?.op !== "drawLine") throw new Error("expected drawLine");
    expect(line.start.y).toBeLessThan(200);
    expect(line.end.y).toBeLessThan(200);
    expect(line.start.x).toBe(100);
    expect(line.end.x).toBeCloseTo(100 + 2 * 10 * 0.55);
  });

  it("draws strike as a line above the baseline when run.strike", () => {
    const ctx = makeColumnContext();
    const run = makeRun({ text: "hi", strike: true, fontSizePt: 10 });
    drawRunSpan(ctx, run, "hi", 100, 200);
    const calls = (ctx.page as MockPage).__calls;
    const line = calls.find((c) => c.op === "drawLine");
    expect(line).toBeDefined();
    if (line?.op !== "drawLine") throw new Error("expected drawLine");
    expect(line.start.y).toBeGreaterThan(200);
  });

  it("emits both underline and strike when both flags set", () => {
    const ctx = makeColumnContext();
    const run = makeRun({ text: "hi", underline: true, strike: true });
    drawRunSpan(ctx, run, "hi", 100, 200);
    const ops = (ctx.page as MockPage).__calls.map((c) => c.op);
    expect(ops).toEqual(["drawText", "drawLine", "drawLine"]);
  });

  it("returns the advance for the supplied text, not run.text", () => {
    const ctx = makeColumnContext();
    const run = makeRun({ text: "the full run text", fontSizePt: 10 });
    const advance = drawRunSpan(ctx, run, "frag", 0, 0);
    expect(advance).toBeCloseTo(4 * 10 * 0.55);
  });

  it("pushes anchor-not-found warning into ctx.warnings on missing anchor", () => {
    // Phase 13 / F2: a hyperlinkAnchor pointing to a name not in
    // ctx.bookmarks must surface a warning so the orchestrator can dedupe
    // and forward to ParsedDocx.warnings. Text was already drawn, so the
    // user gets plain-text fallback + warning per spec §10.
    const ctx = makeColumnContext();
    ctx.relationships = new Map();
    ctx.bookmarks = new Set();
    ctx.warnings = [];
    const run = makeRun({ text: "click", hyperlinkAnchor: "missing-target" });
    drawRunSpan(ctx, run, "click", 100, 200);
    expect(ctx.warnings).toEqual(["anchor not found: missing-target"]);
  });

  it("does NOT push a warning when ctx.warnings is undefined (silent fallback)", () => {
    // Defensive: callers that don't supply a warnings sink (older test
    // helpers, scratch contexts) get the plain-text fallback without
    // crashing on a push to undefined.
    const ctx = makeColumnContext();
    ctx.relationships = new Map();
    ctx.bookmarks = new Set();
    // ctx.warnings stays undefined
    const run = makeRun({ text: "click", hyperlinkAnchor: "missing-target" });
    expect(() => drawRunSpan(ctx, run, "click", 100, 200)).not.toThrow();
  });

  it("does NOT push a warning when anchor IS declared in ctx.bookmarks", () => {
    const ctx = makeColumnContext();
    ctx.relationships = new Map();
    ctx.bookmarks = new Set(["intro"]);
    ctx.warnings = [];
    const run = makeRun({ text: "click", hyperlinkAnchor: "intro" });
    drawRunSpan(ctx, run, "click", 100, 200);
    expect(ctx.warnings).toEqual([]);
  });

  it("dedupes the anchor-not-found warning across repeated references", () => {
    // 50 references to the same missing anchor (or a tables.ts measure-pass
    // followed by draw-pass, which calls drawRunSpan twice for cells)
    // would push 50 identical strings without dedupe.
    const ctx = makeColumnContext();
    ctx.relationships = new Map();
    ctx.bookmarks = new Set();
    ctx.warnings = [];
    const run = makeRun({ text: "click", hyperlinkAnchor: "missing-target" });
    for (let i = 0; i < 5; i++) {
      drawRunSpan(ctx, run, "click", 100, 200);
    }
    expect(ctx.warnings).toEqual(["anchor not found: missing-target"]);
  });

  it("dedupes per-anchor — different missing anchors each get one warning", () => {
    const ctx = makeColumnContext();
    ctx.relationships = new Map();
    ctx.bookmarks = new Set();
    ctx.warnings = [];
    drawRunSpan(ctx, makeRun({ text: "a", hyperlinkAnchor: "one" }), "a", 100, 200);
    drawRunSpan(ctx, makeRun({ text: "b", hyperlinkAnchor: "two" }), "b", 100, 200);
    drawRunSpan(ctx, makeRun({ text: "a", hyperlinkAnchor: "one" }), "a", 100, 200);
    expect(ctx.warnings).toEqual(["anchor not found: one", "anchor not found: two"]);
  });
});

describe("decorationThickness", () => {
  it("0.5pt floor at body size", () => {
    expect(decorationThickness(DEFAULT_FONT_SIZE_PT)).toBe(0.5);
  });

  it("scales above the floor at heading sizes", () => {
    expect(decorationThickness(22)).toBeCloseTo(0.5 * (22 / DEFAULT_FONT_SIZE_PT));
  });

  it("does not drop below 0.5pt at small sizes", () => {
    expect(decorationThickness(6)).toBe(0.5);
  });
});

describe("parseColorHex", () => {
  it.each([
    ["FF0000", { r: 1, g: 0, b: 0 }],
    ["00FF00", { r: 0, g: 1, b: 0 }],
    ["0000FF", { r: 0, g: 0, b: 1 }],
    ["808080", { r: 128 / 255, g: 128 / 255, b: 128 / 255 }],
  ])("parses %s correctly", (hex, expected) => {
    const c = parseColorHex(hex) as { red: number; green: number; blue: number };
    expect(c.red).toBeCloseTo(expected.r);
    expect(c.green).toBeCloseTo(expected.g);
    expect(c.blue).toBeCloseTo(expected.b);
  });

  it("returns black for undefined", () => {
    const c = parseColorHex(undefined) as { red: number; green: number; blue: number };
    expect(c.red).toBe(0);
    expect(c.green).toBe(0);
    expect(c.blue).toBe(0);
  });

  it("returns black for malformed hex", () => {
    const c = parseColorHex("zzz") as { red: number; green: number; blue: number };
    expect(c.red).toBe(0);
  });

  it("accepts mixed-case hex", () => {
    const c = parseColorHex("ff00FF") as { red: number; green: number; blue: number };
    expect(c.red).toBeCloseTo(1);
    expect(c.green).toBe(0);
    expect(c.blue).toBeCloseTo(1);
  });
});
