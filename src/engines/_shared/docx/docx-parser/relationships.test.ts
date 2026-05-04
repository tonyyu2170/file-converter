import { describe, expect, it } from "vitest";
import { parseRelationshipsXml } from "./relationships";

const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';

function rels(...entries: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships ${REL_NS}>${entries.join("")}</Relationships>`;
}

describe("parseRelationshipsXml", () => {
  it("parses an image relationship with internal target", () => {
    const xml = rels(
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>`,
    );
    const { value, warnings } = parseRelationshipsXml(xml);
    expect(warnings).toEqual([]);
    expect(value.size).toBe(1);
    expect(value.get("rId1")).toEqual({
      id: "rId1",
      type: "image",
      target: "media/image1.png",
    });
  });

  it("parses a hyperlink relationship and preserves TargetMode=External", () => {
    const xml = rels(
      `<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>`,
    );
    const { value, warnings } = parseRelationshipsXml(xml);
    expect(warnings).toEqual([]);
    expect(value.get("rId7")).toEqual({
      id: "rId7",
      type: "hyperlink",
      target: "https://example.com",
      targetMode: "External",
    });
  });

  it("classifies header / footer / footnote / endnote / styles / numbering / fontTable types", () => {
    const xml = rels(
      `<Relationship Id="r1" Type=".../header" Target="header1.xml"/>`,
      `<Relationship Id="r2" Type=".../footer" Target="footer1.xml"/>`,
      `<Relationship Id="r3" Type=".../footnotes" Target="footnotes.xml"/>`,
      `<Relationship Id="r4" Type=".../endnotes" Target="endnotes.xml"/>`,
      `<Relationship Id="r5" Type=".../styles" Target="styles.xml"/>`,
      `<Relationship Id="r6" Type=".../numbering" Target="numbering.xml"/>`,
      `<Relationship Id="r7" Type=".../fontTable" Target="fontTable.xml"/>`,
    );
    const { value } = parseRelationshipsXml(xml);
    expect(value.get("r1")?.type).toBe("header");
    expect(value.get("r2")?.type).toBe("footer");
    expect(value.get("r3")?.type).toBe("footnotes");
    expect(value.get("r4")?.type).toBe("endnotes");
    expect(value.get("r5")?.type).toBe("styles");
    expect(value.get("r6")?.type).toBe("numbering");
    expect(value.get("r7")?.type).toBe("fontTable");
  });

  it('falls back to "other" for unknown / missing Type values', () => {
    const xml = rels(
      `<Relationship Id="r1" Type=".../theme" Target="theme/theme1.xml"/>`,
      `<Relationship Id="r2" Target="settings.xml"/>`,
    );
    const { value } = parseRelationshipsXml(xml);
    expect(value.get("r1")?.type).toBe("other");
    expect(value.get("r2")?.type).toBe("other");
  });

  it("handles a many-relationship document and preserves order via Map insertion order", () => {
    const xml = rels(
      ...Array.from(
        { length: 10 },
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type=".../image" Target="media/image${i + 1}.png"/>`,
      ),
    );
    const { value } = parseRelationshipsXml(xml);
    expect(value.size).toBe(10);
    const ids = [...value.keys()];
    expect(ids[0]).toBe("rId1");
    expect(ids[9]).toBe("rId10");
  });

  it("returns empty map with warning on malformed XML", () => {
    const { value, warnings } = parseRelationshipsXml("<<not xml>>");
    expect(value.size).toBe(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/malformed/);
  });

  it("returns empty map with warning when root element is wrong", () => {
    const xml = `<NotRelationships ${REL_NS}><Relationship Id="rId1" Type=".../image" Target="x"/></NotRelationships>`;
    const { value, warnings } = parseRelationshipsXml(xml);
    expect(value.size).toBe(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("silently skips Relationship entries missing Id or Target", () => {
    const xml = rels(
      `<Relationship Type=".../image" Target="media/image1.png"/>`, // no Id
      `<Relationship Id="rId2" Type=".../image"/>`, // no Target
      `<Relationship Id="rId3" Type=".../image" Target="media/image2.png"/>`,
    );
    const { value, warnings } = parseRelationshipsXml(xml);
    expect(value.size).toBe(1);
    expect(value.has("rId3")).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("returns empty map for an empty <Relationships/> document", () => {
    const xml = `<Relationships ${REL_NS}/>`;
    const { value, warnings } = parseRelationshipsXml(xml);
    expect(value.size).toBe(0);
    expect(warnings).toEqual([]);
  });
});
