import { describe, expect, it } from "vitest";
import { parseNumberingXml } from "./numbering-xml";

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function numbering(...inner: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><w:numbering ${W_NS}>${inner.join("")}</w:numbering>`;
}

function abstractNum(id: string, ...lvls: string[]): string {
  return `<w:abstractNum w:abstractNumId="${id}">${lvls.join("")}</w:abstractNum>`;
}

function lvl(ilvl: number, format: string, text: string): string {
  return `<w:lvl w:ilvl="${ilvl}"><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/></w:lvl>`;
}

describe("parseNumberingXml", () => {
  it("returns empty map (no warnings) for empty <w:numbering/>", () => {
    const { value, warnings } = parseNumberingXml(`<w:numbering ${W_NS}/>`);
    expect(value.size).toBe(0);
    expect(warnings).toEqual([]);
  });

  it("resolves a single decimal-numbered list with one level", () => {
    const xml = numbering(
      abstractNum("0", lvl(0, "decimal", "%1.")),
      `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`,
    );
    const { value, warnings } = parseNumberingXml(xml);
    expect(warnings).toEqual([]);
    const def = value.get("1");
    expect(def).toBeDefined();
    expect(def?.numId).toBe("1");
    expect(def?.levels.size).toBe(1);
    expect(def?.levels.get(0)).toEqual({ ilvl: 0, format: "decimal", text: "%1." });
  });

  it("resolves a 9-level nested numbering chain with mixed formats", () => {
    const xml = numbering(
      abstractNum(
        "0",
        lvl(0, "decimal", "%1."),
        lvl(1, "lowerLetter", "%2."),
        lvl(2, "lowerRoman", "%3."),
        lvl(3, "upperLetter", "%4."),
        lvl(4, "upperRoman", "%5."),
        lvl(5, "decimal", "%6."),
        lvl(6, "lowerLetter", "%7."),
        lvl(7, "lowerRoman", "%8."),
        lvl(8, "decimal", "%9."),
      ),
      `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`,
    );
    const def = parseNumberingXml(xml).value.get("1");
    expect(def?.levels.size).toBe(9);
    expect(def?.levels.get(0)?.format).toBe("decimal");
    expect(def?.levels.get(1)?.format).toBe("lowerLetter");
    expect(def?.levels.get(2)?.format).toBe("lowerRoman");
    expect(def?.levels.get(8)?.format).toBe("decimal");
  });

  it("resolves a bullet list", () => {
    const xml = numbering(
      abstractNum("0", lvl(0, "bullet", "•")),
      `<w:num w:numId="2"><w:abstractNumId w:val="0"/></w:num>`,
    );
    const def = parseNumberingXml(xml).value.get("2");
    expect(def?.levels.get(0)).toEqual({ ilvl: 0, format: "bullet", text: "•" });
  });

  it("normalizes unrecognized w:numFmt values to 'decimal'", () => {
    const xml = numbering(
      abstractNum("0", lvl(0, "chineseCounting", "%1.")),
      `<w:num w:numId="9"><w:abstractNumId w:val="0"/></w:num>`,
    );
    expect(parseNumberingXml(xml).value.get("9")?.levels.get(0)?.format).toBe("decimal");
  });

  it("clamps ilvl outside 0–8 by skipping the level", () => {
    const xml = numbering(
      abstractNum("0", lvl(0, "decimal", "%1."), lvl(9, "decimal", "%10.")),
      `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`,
    );
    const def = parseNumberingXml(xml).value.get("1");
    expect(def?.levels.size).toBe(1);
    expect(def?.levels.has(9)).toBe(false);
  });

  it("supports multiple <w:num> instances sharing one abstractNum", () => {
    const xml = numbering(
      abstractNum("0", lvl(0, "decimal", "%1.")),
      `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`,
      `<w:num w:numId="2"><w:abstractNumId w:val="0"/></w:num>`,
    );
    const { value } = parseNumberingXml(xml);
    expect(value.size).toBe(2);
    expect(value.get("1")?.levels.get(0)?.format).toBe("decimal");
    expect(value.get("2")?.levels.get(0)?.format).toBe("decimal");
  });

  it("applies <w:lvlOverride> on top of the abstract levels", () => {
    const xml = numbering(
      abstractNum("0", lvl(0, "decimal", "%1."), lvl(1, "lowerLetter", "%2.")),
      '<w:num w:numId="1">',
      '  <w:abstractNumId w:val="0"/>',
      `  <w:lvlOverride w:ilvl="0">${lvl(0, "upperRoman", "%1)")}</w:lvlOverride>`,
      "</w:num>",
    );
    const def = parseNumberingXml(xml).value.get("1");
    expect(def?.levels.get(0)).toEqual({ ilvl: 0, format: "upperRoman", text: "%1)" });
    // ilvl 1 unchanged from abstract.
    expect(def?.levels.get(1)?.format).toBe("lowerLetter");
  });

  it("does not let one num's override leak into another sharing the same abstractNum", () => {
    const xml = numbering(
      abstractNum("0", lvl(0, "decimal", "%1.")),
      '<w:num w:numId="1">',
      '  <w:abstractNumId w:val="0"/>',
      `  <w:lvlOverride w:ilvl="0">${lvl(0, "upperRoman", "%1)")}</w:lvlOverride>`,
      "</w:num>",
      `<w:num w:numId="2"><w:abstractNumId w:val="0"/></w:num>`,
    );
    const { value } = parseNumberingXml(xml);
    expect(value.get("1")?.levels.get(0)?.format).toBe("upperRoman");
    expect(value.get("2")?.levels.get(0)?.format).toBe("decimal");
  });

  it("results in empty levels for a num pointing to a missing abstractNumId", () => {
    const xml = numbering(`<w:num w:numId="1"><w:abstractNumId w:val="999"/></w:num>`);
    const def = parseNumberingXml(xml).value.get("1");
    expect(def).toBeDefined();
    expect(def?.levels.size).toBe(0);
  });

  it("skips <w:num> entries lacking w:numId", () => {
    const xml = numbering(`<w:num><w:abstractNumId w:val="0"/></w:num>`);
    expect(parseNumberingXml(xml).value.size).toBe(0);
  });

  it("returns empty map with warning on malformed XML", () => {
    const { value, warnings } = parseNumberingXml("<broken");
    expect(value.size).toBe(0);
    expect(warnings).toHaveLength(1);
  });

  it("returns empty map with warning when root element is missing", () => {
    const { value, warnings } = parseNumberingXml(`<root ${W_NS}/>`);
    expect(value.size).toBe(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("preserves an empty levels map for a level-less abstract definition", () => {
    const xml = numbering(
      abstractNum("0"),
      `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`,
    );
    const def = parseNumberingXml(xml).value.get("1");
    expect(def?.levels.size).toBe(0);
  });

  it("defaults to empty text when <w:lvlText> is absent", () => {
    const xml = numbering(
      `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>`,
      `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`,
    );
    expect(parseNumberingXml(xml).value.get("1")?.levels.get(0)?.text).toBe("");
  });
});
