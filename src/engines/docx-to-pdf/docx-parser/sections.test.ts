import { describe, expect, it } from "vitest";
import {
  defaultSectionProperties,
  parseSectionProperties,
  parseSectionPropertiesFromXml,
} from "./sections";

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R_NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const HDR = `<?xml version="1.0" encoding="UTF-8"?>`;

function wrap(...inner: string[]): string {
  // Wrap the sectPr inside a body so the helper has to walk to find it.
  return `${HDR}<w:document ${W_NS} ${R_NS}><w:body><w:sectPr>${inner.join("")}</w:sectPr></w:body></w:document>`;
}

describe("defaultSectionProperties", () => {
  it("returns Letter portrait, 1in margins, 1 column, no refs", () => {
    expect(defaultSectionProperties()).toEqual({
      pageSize: { widthPt: 612, heightPt: 792 },
      pageMargins: { top: 72, right: 72, bottom: 72, left: 72 },
      columns: { count: 1, spaceBetween: 0 },
      headerRefs: {},
      footerRefs: {},
    });
  });

  it("returns a fresh object on each call (no shared mutation hazard)", () => {
    const a = defaultSectionProperties();
    const b = defaultSectionProperties();
    a.pageSize.widthPt = 0;
    expect(b.pageSize.widthPt).toBe(612);
  });
});

describe("parseSectionProperties (single sectPr node)", () => {
  it("returns defaults when input is undefined", () => {
    const { value, warnings } = parseSectionProperties(undefined);
    expect(value).toEqual(defaultSectionProperties());
    expect(warnings).toEqual([]);
  });

  it("returns defaults when input is null", () => {
    const { value } = parseSectionProperties(null);
    expect(value).toEqual(defaultSectionProperties());
  });

  it("returns defaults when input is a plain string (empty self-closed sectPr)", () => {
    const { value } = parseSectionProperties("");
    expect(value).toEqual(defaultSectionProperties());
  });
});

describe("parseSectionPropertiesFromXml", () => {
  it("returns defaults (with warning) for an empty XML string", () => {
    const { value, warnings } = parseSectionPropertiesFromXml("");
    expect(value).toEqual(defaultSectionProperties());
    expect(warnings).toHaveLength(1);
  });

  it("returns defaults (with warning) when no sectPr is found", () => {
    const { value, warnings } = parseSectionPropertiesFromXml(
      `${HDR}<w:document ${W_NS}><w:body/></w:document>`,
    );
    expect(value).toEqual(defaultSectionProperties());
    expect(warnings).toHaveLength(1);
  });

  it("converts page size from twips to pt (12240 × 15840 → 612 × 792)", () => {
    const xml = wrap(`<w:pgSz w:w="12240" w:h="15840"/>`);
    expect(parseSectionPropertiesFromXml(xml).value.pageSize).toEqual({
      widthPt: 612,
      heightPt: 792,
    });
  });

  it("converts A4 page size (11906 × 16838 → ~595.3 × ~841.9)", () => {
    const xml = wrap(`<w:pgSz w:w="11906" w:h="16838"/>`);
    const { pageSize } = parseSectionPropertiesFromXml(xml).value;
    expect(pageSize.widthPt).toBeCloseTo(595.3, 1);
    expect(pageSize.heightPt).toBeCloseTo(841.9, 1);
  });

  it("falls back to default page size when w:w / w:h are missing or zero", () => {
    const xml = wrap("<w:pgSz/>");
    expect(parseSectionPropertiesFromXml(xml).value.pageSize).toEqual({
      widthPt: 612,
      heightPt: 792,
    });
  });

  it("converts margins from twips to pt and clamps negatives at 0", () => {
    const xml = wrap(`<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>`);
    expect(parseSectionPropertiesFromXml(xml).value.pageMargins).toEqual({
      top: 72,
      right: 72,
      bottom: 72,
      left: 72,
    });

    const xml2 = wrap(`<w:pgMar w:top="-100" w:right="0" w:bottom="2880" w:left="720"/>`);
    expect(parseSectionPropertiesFromXml(xml2).value.pageMargins).toEqual({
      top: 0,
      right: 0,
      bottom: 144,
      left: 36,
    });
  });

  it("falls back to default margins when individual margin attrs are missing", () => {
    const xml = wrap(`<w:pgMar w:top="2880"/>`);
    expect(parseSectionPropertiesFromXml(xml).value.pageMargins).toEqual({
      top: 144,
      right: 72,
      bottom: 72,
      left: 72,
    });
  });

  it("parses multi-column geometry from <w:cols w:num='3' w:space='720'/>", () => {
    const xml = wrap(`<w:cols w:num="3" w:space="720"/>`);
    expect(parseSectionPropertiesFromXml(xml).value.columns).toEqual({
      count: 3,
      spaceBetween: 36,
    });
  });

  it("treats missing or zero w:num as count=1", () => {
    expect(parseSectionPropertiesFromXml(wrap("<w:cols/>")).value.columns.count).toBe(1);
    expect(parseSectionPropertiesFromXml(wrap(`<w:cols w:num="0"/>`)).value.columns.count).toBe(1);
  });

  it("clamps absurd column counts at 45", () => {
    expect(parseSectionPropertiesFromXml(wrap(`<w:cols w:num="9999"/>`)).value.columns.count).toBe(
      45,
    );
  });

  it("extracts headerRefs by w:type (default / first / even)", () => {
    const xml = wrap(
      `<w:headerReference w:type="default" r:id="rIdH1"/>`,
      `<w:headerReference w:type="first" r:id="rIdH2"/>`,
      `<w:headerReference w:type="even" r:id="rIdH3"/>`,
    );
    expect(parseSectionPropertiesFromXml(xml).value.headerRefs).toEqual({
      default: "rIdH1",
      first: "rIdH2",
      even: "rIdH3",
    });
  });

  it("extracts footerRefs by w:type", () => {
    const xml = wrap(
      `<w:footerReference w:type="default" r:id="rIdF1"/>`,
      `<w:footerReference w:type="first" r:id="rIdF2"/>`,
    );
    const { footerRefs } = parseSectionPropertiesFromXml(xml).value;
    expect(footerRefs).toEqual({ default: "rIdF1", first: "rIdF2" });
  });

  it("treats missing w:type on a reference as 'default'", () => {
    const xml = wrap(`<w:headerReference r:id="rIdH1"/>`);
    expect(parseSectionPropertiesFromXml(xml).value.headerRefs).toEqual({
      default: "rIdH1",
    });
  });

  it("skips <w:headerReference> entries lacking r:id", () => {
    const xml = wrap(`<w:headerReference w:type="default"/>`);
    expect(parseSectionPropertiesFromXml(xml).value.headerRefs).toEqual({});
  });

  it("returns full configuration when all elements are present", () => {
    const xml = wrap(
      `<w:pgSz w:w="11906" w:h="16838"/>`,
      `<w:pgMar w:top="1440" w:right="720" w:bottom="1440" w:left="720"/>`,
      `<w:cols w:num="2" w:space="360"/>`,
      `<w:headerReference w:type="default" r:id="rH1"/>`,
      `<w:footerReference w:type="default" r:id="rF1"/>`,
    );
    const { value, warnings } = parseSectionPropertiesFromXml(xml);
    expect(warnings).toEqual([]);
    expect(value.columns).toEqual({ count: 2, spaceBetween: 18 });
    expect(value.headerRefs.default).toBe("rH1");
    expect(value.footerRefs.default).toBe("rF1");
  });

  it("returns defaults with warning on malformed XML", () => {
    const { value, warnings } = parseSectionPropertiesFromXml("<<broken");
    expect(value).toEqual(defaultSectionProperties());
    expect(warnings).toHaveLength(1);
  });
});
