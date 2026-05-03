import { describe, expect, it } from "vitest";
import { parseFontTableXml } from "./font-table-xml";

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function fonts(...entries: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><w:fonts ${W_NS}>${entries.join("")}</w:fonts>`;
}

describe("parseFontTableXml", () => {
  it("parses a single font with family classification", () => {
    const xml = fonts(`<w:font w:name="Calibri"><w:family w:val="swiss"/></w:font>`);
    const { value, warnings } = parseFontTableXml(xml);
    expect(warnings).toEqual([]);
    expect(value.size).toBe(1);
    expect(value.get("Calibri")).toEqual({ name: "Calibri", family: "swiss" });
  });

  it.each<[string, string]>([
    ["roman", "roman"],
    ["swiss", "swiss"],
    ["modern", "modern"],
    ["script", "script"],
    ["decorative", "decorative"],
    ["auto", "auto"],
  ])("recognizes <w:family> value %s", (raw, expected) => {
    const xml = fonts(`<w:font w:name="Test"><w:family w:val="${raw}"/></w:font>`);
    const { value } = parseFontTableXml(xml);
    expect(value.get("Test")?.family).toBe(expected);
  });

  it("normalizes family case-insensitively", () => {
    const xml = fonts(`<w:font w:name="Test"><w:family w:val="SwIsS"/></w:font>`);
    const { value } = parseFontTableXml(xml);
    expect(value.get("Test")?.family).toBe("swiss");
  });

  it("omits family when <w:family> is missing", () => {
    const xml = fonts(`<w:font w:name="Calibri"/>`);
    const { value, warnings } = parseFontTableXml(xml);
    expect(warnings).toEqual([]);
    expect(value.get("Calibri")).toEqual({ name: "Calibri" });
    expect("family" in (value.get("Calibri") ?? {})).toBe(false);
  });

  it("omits family when <w:family w:val> is unrecognized", () => {
    const xml = fonts(`<w:font w:name="Custom"><w:family w:val="madeup"/></w:font>`);
    const { value } = parseFontTableXml(xml);
    expect(value.get("Custom")).toEqual({ name: "Custom" });
  });

  it("skips <w:font> entries missing a name attribute", () => {
    const xml = fonts(
      `<w:font><w:family w:val="swiss"/></w:font>`,
      `<w:font w:name="Cambria"><w:family w:val="roman"/></w:font>`,
    );
    const { value } = parseFontTableXml(xml);
    expect(value.size).toBe(1);
    expect(value.has("Cambria")).toBe(true);
  });

  it("returns map of multiple fonts in document order", () => {
    const xml = fonts(
      `<w:font w:name="Calibri"><w:family w:val="swiss"/></w:font>`,
      `<w:font w:name="Cambria"><w:family w:val="roman"/></w:font>`,
      `<w:font w:name="Courier New"><w:family w:val="modern"/></w:font>`,
    );
    const { value } = parseFontTableXml(xml);
    expect([...value.keys()]).toEqual(["Calibri", "Cambria", "Courier New"]);
  });

  it("returns empty map with warning on malformed XML", () => {
    const { value, warnings } = parseFontTableXml("<<broken");
    expect(value.size).toBe(0);
    expect(warnings).toHaveLength(1);
  });

  it("returns empty map with warning when <w:fonts> root is missing", () => {
    const xml = `<w:notFonts ${W_NS}><w:font w:name="X"/></w:notFonts>`;
    const { value, warnings } = parseFontTableXml(xml);
    expect(value.size).toBe(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("returns empty map (no warning) on an empty <w:fonts/> document", () => {
    const xml = `<w:fonts ${W_NS}/>`;
    const { value, warnings } = parseFontTableXml(xml);
    expect(value.size).toBe(0);
    expect(warnings).toEqual([]);
  });
});
