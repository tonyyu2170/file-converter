import { describe, expect, it } from "vitest";
import { parseStylesXml, resolveStyle } from "./styles-xml";
import { DEFAULT_STYLE_KEY } from "./types";

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function styles(...inner: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><w:styles ${W_NS}>${inner.join("")}</w:styles>`;
}

describe("parseStylesXml", () => {
  it("parses an empty <w:styles/> document into an empty map (no warning)", () => {
    const { value, warnings } = parseStylesXml(`<w:styles ${W_NS}/>`);
    expect(value.size).toBe(0);
    expect(warnings).toEqual([]);
  });

  it("parses a single paragraph style with run + paragraph props", () => {
    const xml = styles(
      '<w:style w:type="paragraph" w:styleId="Heading1">',
      '  <w:name w:val="heading 1"/>',
      '  <w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="2E74B5"/></w:rPr>',
      '  <w:pPr><w:jc w:val="center"/></w:pPr>',
      "</w:style>",
    );
    const { value, warnings } = parseStylesXml(xml);
    expect(warnings).toEqual([]);
    const h1 = value.get("Heading1");
    expect(h1).toBeDefined();
    expect(h1?.styleId).toBe("Heading1");
    expect(h1?.type).toBe("paragraph");
    expect(h1?.name).toBe("heading 1");
    expect(h1?.runProps).toEqual({ bold: true, fontSizePt: 16, colorHex: "2E74B5" });
    expect(h1?.paragraphProps).toEqual({ alignment: "center" });
  });

  it("converts <w:sz> half-points to whole points (24 → 12)", () => {
    const xml = styles(
      `<w:style w:type="paragraph" w:styleId="Body"><w:rPr><w:sz w:val="24"/></w:rPr></w:style>`,
    );
    const { value } = parseStylesXml(xml);
    expect(value.get("Body")?.runProps.fontSizePt).toBe(12);
  });

  it.each<[string, "left" | "center" | "right" | "justify"]>([
    ["left", "left"],
    ["start", "left"],
    ["center", "center"],
    ["right", "right"],
    ["end", "right"],
    ["both", "justify"],
    ["justify", "justify"],
    ["distribute", "justify"],
  ])("normalizes alignment <w:jc w:val=%j> to %j", (raw, expected) => {
    const xml = styles(
      `<w:style w:type="paragraph" w:styleId="X"><w:pPr><w:jc w:val="${raw}"/></w:pPr></w:style>`,
    );
    expect(parseStylesXml(xml).value.get("X")?.paragraphProps.alignment).toBe(expected);
  });

  it("treats <w:b/> w:val=0 as false (explicit off)", () => {
    const xml = styles(
      `<w:style w:type="paragraph" w:styleId="X"><w:rPr><w:b w:val="0"/></w:rPr></w:style>`,
    );
    expect(parseStylesXml(xml).value.get("X")?.runProps.bold).toBe(false);
  });

  it("treats <w:b/> with no attribute as true", () => {
    const xml = styles(`<w:style w:type="paragraph" w:styleId="X"><w:rPr><w:b/></w:rPr></w:style>`);
    expect(parseStylesXml(xml).value.get("X")?.runProps.bold).toBe(true);
  });

  it("captures basedOn parent when present (inheritance unresolved at parse time)", () => {
    const xml = styles(
      `<w:style w:type="paragraph" w:styleId="Heading1"><w:basedOn w:val="Normal"/></w:style>`,
    );
    expect(parseStylesXml(xml).value.get("Heading1")?.basedOn).toBe("Normal");
  });

  it("normalizes unknown w:type values to 'paragraph'", () => {
    const xml = styles(`<w:style w:type="madeup" w:styleId="X"><w:name w:val="X"/></w:style>`);
    expect(parseStylesXml(xml).value.get("X")?.type).toBe("paragraph");
  });

  it("synthesizes the __default style from <w:docDefaults>", () => {
    const xml = styles(
      "<w:docDefaults>",
      '  <w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>',
      '  <w:pPrDefault><w:pPr><w:jc w:val="left"/></w:pPr></w:pPrDefault>',
      "</w:docDefaults>",
    );
    const { value } = parseStylesXml(xml);
    const def = value.get(DEFAULT_STYLE_KEY);
    expect(def).toBeDefined();
    expect(def?.runProps).toEqual({ fontFamily: "Calibri", fontSizePt: 11 });
    expect(def?.paragraphProps).toEqual({ alignment: "left" });
  });

  it("ignores a real style attempting to use the __default styleId", () => {
    const xml = styles(
      `<w:style w:type="paragraph" w:styleId="${DEFAULT_STYLE_KEY}"><w:name w:val="evil"/></w:style>`,
    );
    expect(parseStylesXml(xml).value.has(DEFAULT_STYLE_KEY)).toBe(false);
  });

  it("ignores invalid color values (non-6-hex and 'auto')", () => {
    const xml = styles(
      `<w:style w:type="paragraph" w:styleId="A"><w:rPr><w:color w:val="auto"/></w:rPr></w:style>`,
      `<w:style w:type="paragraph" w:styleId="B"><w:rPr><w:color w:val="red"/></w:rPr></w:style>`,
    );
    const { value } = parseStylesXml(xml);
    expect(value.get("A")?.runProps.colorHex).toBeUndefined();
    expect(value.get("B")?.runProps.colorHex).toBeUndefined();
  });

  it("returns empty map with warning on malformed XML", () => {
    const { value, warnings } = parseStylesXml("<<<broken");
    expect(value.size).toBe(0);
    expect(warnings).toHaveLength(1);
  });

  it("returns empty map with warning when <w:styles> root is missing", () => {
    const { value, warnings } = parseStylesXml(
      `<root ${W_NS}><w:style w:type="paragraph" w:styleId="X"/></root>`,
    );
    expect(value.size).toBe(0);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe("resolveStyle", () => {
  it("returns empty props when styleId is unknown", () => {
    const { value } = parseStylesXml(`<w:styles ${W_NS}/>`);
    const { runProps, paragraphProps, warnings } = resolveStyle(value, "Missing");
    expect(runProps).toEqual({});
    expect(paragraphProps).toEqual({});
    expect(warnings).toEqual([]);
  });

  it("resolves a single style with no basedOn (just its own props)", () => {
    const xml = styles(
      `<w:style w:type="paragraph" w:styleId="Body"><w:rPr><w:sz w:val="22"/></w:rPr></w:style>`,
    );
    const { value } = parseStylesXml(xml);
    const r = resolveStyle(value, "Body");
    expect(r.runProps).toEqual({ fontSizePt: 11 });
  });

  it("resolves an ancestor chain with child overriding parent", () => {
    const xml = styles(
      '<w:style w:type="paragraph" w:styleId="Normal"><w:rPr><w:sz w:val="22"/></w:rPr></w:style>',
      '<w:style w:type="paragraph" w:styleId="Heading1">',
      '  <w:basedOn w:val="Normal"/>',
      '  <w:rPr><w:b/><w:sz w:val="32"/></w:rPr>',
      "</w:style>",
    );
    const { value } = parseStylesXml(xml);
    const r = resolveStyle(value, "Heading1");
    // Heading1 wins on sz; Normal contributed nothing else.
    expect(r.runProps).toEqual({ bold: true, fontSizePt: 16 });
  });

  it("folds __default props in first (lowest precedence)", () => {
    const xml = styles(
      `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>`,
      `<w:style w:type="paragraph" w:styleId="Body"><w:rPr><w:sz w:val="24"/></w:rPr></w:style>`,
    );
    const { value } = parseStylesXml(xml);
    const r = resolveStyle(value, "Body");
    // Body overrides sz; default supplies fontFamily.
    expect(r.runProps).toEqual({ fontFamily: "Calibri", fontSizePt: 12 });
  });

  it("emits a warning and halts on a basedOn cycle", () => {
    const xml = styles(
      `<w:style w:type="paragraph" w:styleId="A"><w:basedOn w:val="B"/><w:rPr><w:b/></w:rPr></w:style>`,
      `<w:style w:type="paragraph" w:styleId="B"><w:basedOn w:val="A"/><w:rPr><w:i/></w:rPr></w:style>`,
    );
    const { value } = parseStylesXml(xml);
    const r = resolveStyle(value, "A");
    expect(r.warnings.some((w) => w.includes("cycle"))).toBe(true);
    // Both A and B's props still merge before the cycle is detected.
    expect(r.runProps.bold).toBe(true);
    expect(r.runProps.italic).toBe(true);
  });

  it("handles a basedOn pointing to a non-existent style without throwing", () => {
    const xml = styles(
      `<w:style w:type="paragraph" w:styleId="A"><w:basedOn w:val="DoesNotExist"/><w:rPr><w:b/></w:rPr></w:style>`,
    );
    const { value } = parseStylesXml(xml);
    const r = resolveStyle(value, "A");
    expect(r.runProps).toEqual({ bold: true });
    expect(r.warnings).toEqual([]);
  });
});
