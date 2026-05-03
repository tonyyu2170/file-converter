import { describe, expect, it } from "vitest";

import { parseBodyXml } from "./document-xml";
import type { Paragraph, Run, Table } from "./types";

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R_NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const M_NS = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const A_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const WP_NS = 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
const HDR = `<?xml version="1.0" encoding="UTF-8"?>`;

function doc(...inner: string[]): string {
  return `${HDR}<w:document ${W_NS} ${R_NS} ${M_NS} ${A_NS} ${WP_NS}><w:body>${inner.join(
    "",
  )}</w:body></w:document>`;
}

function p(...inner: string[]): string {
  return `<w:p>${inner.join("")}</w:p>`;
}

function r(...inner: string[]): string {
  return `<w:r>${inner.join("")}</w:r>`;
}

function t(text: string, preserve = true): string {
  return preserve ? `<w:t xml:space="preserve">${text}</w:t>` : `<w:t>${text}</w:t>`;
}

/* ------------------------------------------------------------------ */
/*   Top-level / shape                                                */
/* ------------------------------------------------------------------ */

describe("parseBodyXml — shape", () => {
  it("returns a single empty section for a body with no children", () => {
    const result = parseBodyXml(doc());
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]?.blocks).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("returns a default section + warning when XML is malformed", () => {
    const result = parseBodyXml("<not-well-formed");
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]?.blocks).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("returns a default section when <w:document> root is missing", () => {
    const result = parseBodyXml(`${HDR}<w:other ${W_NS}/>`);
    expect(result.sections).toHaveLength(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("returns a default section when <w:body> is missing", () => {
    const result = parseBodyXml(`${HDR}<w:document ${W_NS}/>`);
    expect(result.sections).toHaveLength(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/*   Paragraphs                                                       */
/* ------------------------------------------------------------------ */

describe("parseBodyXml — paragraphs", () => {
  it("parses a paragraph with a single text run", () => {
    const xml = doc(p(r(t("Hello, world"))));
    const result = parseBodyXml(xml);
    const blocks = result.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(1);
    const para = blocks[0] as Paragraph;
    expect(para.kind).toBe("paragraph");
    expect(para.alignment).toBe("left");
    expect(para.runs).toHaveLength(1);
    expect(para.runs[0]?.text).toBe("Hello, world");
  });

  it.each([
    ["left", "left"],
    ["start", "left"],
    ["center", "center"],
    ["right", "right"],
    ["end", "right"],
    ["both", "justify"],
    ["distribute", "justify"],
    ["justify", "justify"],
  ])("normalizes alignment %s → %s", (raw, expected) => {
    const xml = doc(p(`<w:pPr><w:jc w:val="${raw}"/></w:pPr>`, r(t("x"))));
    const para = parseBodyXml(xml).sections[0]?.blocks[0] as Paragraph;
    expect(para.alignment).toBe(expected);
  });

  it("defaults alignment to left when <w:jc> is absent", () => {
    const xml = doc(p(r(t("x"))));
    const para = parseBodyXml(xml).sections[0]?.blocks[0] as Paragraph;
    expect(para.alignment).toBe("left");
  });

  it("captures pStyle on the paragraph", () => {
    const xml = doc(p(`<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>`, r(t("Title"))));
    const para = parseBodyXml(xml).sections[0]?.blocks[0] as Paragraph;
    expect(para.styleId).toBe("Heading1");
  });

  it("captures numPr (numId + ilvl)", () => {
    const xml = doc(
      p(
        `<w:pPr><w:numPr><w:ilvl w:val="2"/><w:numId w:val="1"/></w:numPr></w:pPr>`,
        r(t("List item")),
      ),
    );
    const para = parseBodyXml(xml).sections[0]?.blocks[0] as Paragraph;
    expect(para.numPr).toEqual({ numId: "1", ilvl: 2 });
  });

  it("defaults ilvl to 0 when missing", () => {
    const xml = doc(p(`<w:pPr><w:numPr><w:numId w:val="3"/></w:numPr></w:pPr>`, r(t("List item"))));
    const para = parseBodyXml(xml).sections[0]?.blocks[0] as Paragraph;
    expect(para.numPr).toEqual({ numId: "3", ilvl: 0 });
  });

  it("returns no numPr when numId is missing", () => {
    const xml = doc(p(`<w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr>`, r(t("x"))));
    const para = parseBodyXml(xml).sections[0]?.blocks[0] as Paragraph;
    expect(para.numPr).toBeUndefined();
  });

  it("preserves multiple paragraphs in document order", () => {
    const xml = doc(p(r(t("a"))), p(r(t("b"))), p(r(t("c"))));
    const blocks = parseBodyXml(xml).sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(3);
    expect((blocks[0] as Paragraph).runs[0]?.text).toBe("a");
    expect((blocks[1] as Paragraph).runs[0]?.text).toBe("b");
    expect((blocks[2] as Paragraph).runs[0]?.text).toBe("c");
  });
});

/* ------------------------------------------------------------------ */
/*   Runs                                                             */
/* ------------------------------------------------------------------ */

describe("parseBodyXml — runs", () => {
  it.each([
    ["w:b", "bold"],
    ["w:i", "italic"],
    ["w:strike", "strike"],
  ])("captures bool run prop <%s/> → %s", (tag, key) => {
    const xml = doc(p(r(`<w:rPr><${tag}/></w:rPr>`, t("x"))));
    const para = parseBodyXml(xml).sections[0]?.blocks[0] as Paragraph;
    const run = para.runs[0] as Run & Record<string, boolean>;
    expect(run[key]).toBe(true);
  });

  it("captures underline (presence)", () => {
    const xml = doc(p(r(`<w:rPr><w:u w:val="single"/></w:rPr>`, t("x"))));
    const para = parseBodyXml(xml).sections[0]?.blocks[0] as Paragraph;
    expect(para.runs[0]?.underline).toBe(true);
  });

  it('captures underline = false when <w:u w:val="none"/>', () => {
    const xml = doc(p(r(`<w:rPr><w:u w:val="none"/></w:rPr>`, t("x"))));
    const para = parseBodyXml(xml).sections[0]?.blocks[0] as Paragraph;
    expect(para.runs[0]?.underline).toBe(false);
  });

  it('treats <w:b w:val="0"/> as bold=false', () => {
    const xml = doc(p(r(`<w:rPr><w:b w:val="0"/></w:rPr>`, t("x"))));
    const para = parseBodyXml(xml).sections[0]?.blocks[0] as Paragraph;
    expect(para.runs[0]?.bold).toBe(false);
  });

  it("captures fontFamily from <w:rFonts w:ascii=...>", () => {
    const xml = doc(p(r(`<w:rPr><w:rFonts w:ascii="Calibri"/></w:rPr>`, t("x"))));
    const para = parseBodyXml(xml).sections[0]?.blocks[0] as Paragraph;
    expect(para.runs[0]?.fontFamily).toBe("Calibri");
  });

  it('converts half-points to whole points (<w:sz w:val="24"/> → 12)', () => {
    const xml = doc(p(r(`<w:rPr><w:sz w:val="24"/></w:rPr>`, t("x"))));
    const para = parseBodyXml(xml).sections[0]?.blocks[0] as Paragraph;
    expect(para.runs[0]?.fontSizePt).toBe(12);
  });

  it("captures color hex (uppercased, no #)", () => {
    const xml = doc(p(r(`<w:rPr><w:color w:val="ff0000"/></w:rPr>`, t("x"))));
    const para = parseBodyXml(xml).sections[0]?.blocks[0] as Paragraph;
    expect(para.runs[0]?.colorHex).toBe("FF0000");
  });

  it('treats <w:color w:val="auto"/> as missing colorHex', () => {
    const xml = doc(p(r(`<w:rPr><w:color w:val="auto"/></w:rPr>`, t("x"))));
    const para = parseBodyXml(xml).sections[0]?.blocks[0] as Paragraph;
    expect(para.runs[0]?.colorHex).toBeUndefined();
  });

  it("concatenates multiple <w:t> nodes within a run", () => {
    const xml = doc(p(r(t("part 1 "), t("part 2"))));
    const para = parseBodyXml(xml).sections[0]?.blocks[0] as Paragraph;
    expect(para.runs[0]?.text).toBe("part 1 part 2");
  });

  it('emits "\\t" for <w:tab/>', () => {
    const xml = doc(p(r(t("a"), "<w:tab/>", t("b"))));
    const para = parseBodyXml(xml).sections[0]?.blocks[0] as Paragraph;
    expect(para.runs[0]?.text).toBe("a\tb");
  });

  it('emits "\\n" for <w:br/>', () => {
    const xml = doc(p(r(t("line1"), "<w:br/>", t("line2"))));
    const para = parseBodyXml(xml).sections[0]?.blocks[0] as Paragraph;
    expect(para.runs[0]?.text).toBe("line1\nline2");
  });

  it("preserves run order with multiple runs", () => {
    const xml = doc(
      p(
        r("<w:rPr><w:b/></w:rPr>", t("Bold ")),
        r(t("normal ")),
        r("<w:rPr><w:i/></w:rPr>", t("italic")),
      ),
    );
    const para = parseBodyXml(xml).sections[0]?.blocks[0] as Paragraph;
    expect(para.runs.map((rn) => rn.text)).toEqual(["Bold ", "normal ", "italic"]);
    expect(para.runs[0]?.bold).toBe(true);
    expect(para.runs[2]?.italic).toBe(true);
  });

  it("drops runs with no content (no text, no image, no ref)", () => {
    const xml = doc(p(r("<w:rPr><w:b/></w:rPr>")));
    const para = parseBodyXml(xml).sections[0]?.blocks[0] as Paragraph;
    expect(para.runs).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*   Hyperlinks                                                       */
/* ------------------------------------------------------------------ */

describe("parseBodyXml — hyperlinks", () => {
  it("propagates the relationship id onto each contained run", () => {
    const xml = doc(p(`<w:hyperlink r:id="rId7">${r(t("click "))}${r(t("here"))}</w:hyperlink>`));
    const para = parseBodyXml(xml).sections[0]?.blocks[0] as Paragraph;
    expect(para.runs).toHaveLength(2);
    expect(para.runs[0]?.hyperlinkRel).toBe("rId7");
    expect(para.runs[1]?.hyperlinkRel).toBe("rId7");
  });

  it("interleaves hyperlinks with normal runs in document order", () => {
    const xml = doc(
      p(r(t("before ")), `<w:hyperlink r:id="rId1">${r(t("link"))}</w:hyperlink>`, r(t(" after"))),
    );
    const para = parseBodyXml(xml).sections[0]?.blocks[0] as Paragraph;
    expect(para.runs.map((rn) => rn.text)).toEqual(["before ", "link", " after"]);
    expect(para.runs[0]?.hyperlinkRel).toBeUndefined();
    expect(para.runs[1]?.hyperlinkRel).toBe("rId1");
    expect(para.runs[2]?.hyperlinkRel).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*   Inline images                                                    */
/* ------------------------------------------------------------------ */

describe("parseBodyXml — inline images", () => {
  it("extracts inline image with rel and pt-converted extents", () => {
    // 914400 EMU = 1 in = 72 pt.
    const xml = doc(
      p(
        r(
          `<w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><a:blip r:embed="rId8"/></a:graphicData></a:graphic></wp:inline></w:drawing>`,
        ),
      ),
    );
    const para = parseBodyXml(xml).sections[0]?.blocks[0] as Paragraph;
    const run = para.runs[0];
    expect(run).toBeDefined();
    expect(run?.inlineImage).toBeDefined();
    expect(run?.inlineImage?.rel).toBe("rId8");
    expect(run?.inlineImage?.widthPt).toBeCloseTo(72, 5);
    expect(run?.inlineImage?.heightPt).toBeCloseTo(72, 5);
  });

  it("converts a paragraph with a non-image drawing into a skip-with-warning", () => {
    // No <a:blip> — this is a shape / SmartArt.
    const xml = doc(
      p(
        r(
          `<w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingShape"></a:graphicData></a:graphic></wp:inline></w:drawing>`,
        ),
      ),
    );
    const result = parseBodyXml(xml);
    const block = result.sections[0]?.blocks[0];
    expect(block).toEqual({ kind: "skip-with-warning", reason: "drawing" });
    expect(result.warnings.some((w) => /drawing/i.test(w))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*   Footnotes / endnotes                                             */
/* ------------------------------------------------------------------ */

describe("parseBodyXml — footnote/endnote refs", () => {
  it("captures footnoteReference id on a run", () => {
    const xml = doc(p(r(`<w:footnoteReference w:id="3"/>`)));
    const para = parseBodyXml(xml).sections[0]?.blocks[0] as Paragraph;
    expect(para.runs[0]?.footnoteRef).toBe("3");
  });

  it("captures endnoteReference id on a run", () => {
    const xml = doc(p(r(`<w:endnoteReference w:id="4"/>`)));
    const para = parseBodyXml(xml).sections[0]?.blocks[0] as Paragraph;
    expect(para.runs[0]?.endnoteRef).toBe("4");
  });
});

/* ------------------------------------------------------------------ */
/*   Tables                                                           */
/* ------------------------------------------------------------------ */

describe("parseBodyXml — tables", () => {
  it("parses a simple 2x2 table", () => {
    const xml = doc(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2880"/><w:gridCol w:w="2880"/></w:tblGrid><w:tr><w:tc>${p(r(t("A1")))}</w:tc><w:tc>${p(r(t("A2")))}</w:tc></w:tr><w:tr><w:tc>${p(r(t("B1")))}</w:tc><w:tc>${p(r(t("B2")))}</w:tc></w:tr></w:tbl>`,
    );
    const block = parseBodyXml(xml).sections[0]?.blocks[0] as Table;
    expect(block.kind).toBe("table");
    expect(block.columnWidthsPt).toEqual([144, 144]); // 2880 / 20 = 144 pt
    expect(block.rows).toHaveLength(2);
    expect(block.rows[0]?.cells).toHaveLength(2);
    expect((block.rows[0]?.cells[0]?.blocks[0] as Paragraph).runs[0]?.text).toBe("A1");
  });

  it("captures gridSpan on a cell (default 1)", () => {
    const xml = doc(
      `<w:tbl><w:tblGrid><w:gridCol w:w="100"/><w:gridCol w:w="100"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>${p(r(t("Spanned")))}</w:tc></w:tr></w:tbl>`,
    );
    const block = parseBodyXml(xml).sections[0]?.blocks[0] as Table;
    expect(block.rows[0]?.cells[0]?.gridSpan).toBe(2);
  });

  it('captures vMerge: "start" with w:val="restart"', () => {
    const xml = doc(
      `<w:tbl><w:tblGrid><w:gridCol w:w="100"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr>${p(r(t("top")))}</w:tc></w:tr></w:tbl>`,
    );
    const block = parseBodyXml(xml).sections[0]?.blocks[0] as Table;
    expect(block.rows[0]?.cells[0]?.vMerge).toBe("start");
  });

  it('captures vMerge: "continue" when <w:vMerge/> has no val', () => {
    const xml = doc(
      `<w:tbl><w:tblGrid><w:gridCol w:w="100"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr>${p(r(t("cont")))}</w:tc></w:tr></w:tbl>`,
    );
    const block = parseBodyXml(xml).sections[0]?.blocks[0] as Table;
    expect(block.rows[0]?.cells[0]?.vMerge).toBe("continue");
  });

  it('defaults vMerge to "none" when no <w:vMerge> is present', () => {
    const xml = doc(
      `<w:tbl><w:tblGrid><w:gridCol w:w="100"/></w:tblGrid><w:tr><w:tc>${p(r(t("plain")))}</w:tc></w:tr></w:tbl>`,
    );
    const block = parseBodyXml(xml).sections[0]?.blocks[0] as Table;
    expect(block.rows[0]?.cells[0]?.vMerge).toBe("none");
  });

  it("preserves table-paragraph interleaving in document order", () => {
    const xml = doc(
      p(r(t("before"))),
      `<w:tbl><w:tblGrid><w:gridCol w:w="100"/></w:tblGrid><w:tr><w:tc>${p(r(t("cell")))}</w:tc></w:tr></w:tbl>`,
      p(r(t("after"))),
    );
    const blocks = parseBodyXml(xml).sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(3);
    expect(blocks[0]?.kind).toBe("paragraph");
    expect(blocks[1]?.kind).toBe("table");
    expect(blocks[2]?.kind).toBe("paragraph");
  });
});

/* ------------------------------------------------------------------ */
/*   Sections                                                         */
/* ------------------------------------------------------------------ */

describe("parseBodyXml — sections", () => {
  it("uses default section properties when no <w:sectPr> is present", () => {
    const result = parseBodyXml(doc(p(r(t("body")))));
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]?.pageSize).toEqual({ widthPt: 612, heightPt: 792 });
    expect(result.sections[0]?.columns.count).toBe(1);
  });

  it("reads body-trailing <w:sectPr> as the final section's properties", () => {
    const xml = doc(
      p(r(t("body"))),
      `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:cols w:num="2" w:space="720"/></w:sectPr>`,
    );
    const result = parseBodyXml(xml);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]?.pageSize.widthPt).toBe(612);
    expect(result.sections[0]?.columns.count).toBe(2);
    expect(result.sections[0]?.blocks).toHaveLength(1);
  });

  it("treats <w:p><w:pPr><w:sectPr> as a section terminator (multi-section)", () => {
    const xml = doc(
      p(r(t("section 1"))),
      p(`<w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr>`, r(t("end of s1"))),
      p(r(t("section 2"))),
      `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:cols w:num="2"/></w:sectPr>`,
    );
    const result = parseBodyXml(xml);
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]?.blocks).toHaveLength(2); // both paragraphs
    expect(result.sections[1]?.blocks).toHaveLength(1);
    expect(result.sections[1]?.columns.count).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/*   Skip-with-warning detection                                      */
/* ------------------------------------------------------------------ */

describe("parseBodyXml — skip-with-warning", () => {
  it("detects RTL paragraph via <w:bidi/> in pPr", () => {
    const xml = doc(p("<w:pPr><w:bidi/></w:pPr>", r(t("rtl text"))));
    const result = parseBodyXml(xml);
    expect(result.sections[0]?.blocks[0]).toEqual({
      kind: "skip-with-warning",
      reason: "RTL paragraph",
    });
    expect(result.warnings.some((w) => /RTL/i.test(w))).toBe(true);
  });

  it("detects RTL paragraph via <w:rtl/> in run rPr", () => {
    const xml = doc(p(r("<w:rPr><w:rtl/></w:rPr>", t("مرحبا"))));
    const result = parseBodyXml(xml);
    expect(result.sections[0]?.blocks[0]).toEqual({
      kind: "skip-with-warning",
      reason: "RTL paragraph",
    });
    expect(result.warnings.some((w) => /RTL/i.test(w))).toBe(true);
  });

  it("detects equation via <m:oMath>", () => {
    const xml = doc(p("<m:oMath><m:r><m:t>x²</m:t></m:r></m:oMath>"));
    const result = parseBodyXml(xml);
    expect(result.sections[0]?.blocks[0]).toEqual({
      kind: "skip-with-warning",
      reason: "equation",
    });
    expect(result.warnings.some((w) => /equation/i.test(w))).toBe(true);
  });

  it("detects equation via <m:oMathPara>", () => {
    const xml = doc(p("<m:oMathPara><m:oMath><m:r><m:t>e=mc²</m:t></m:r></m:oMath></m:oMathPara>"));
    const result = parseBodyXml(xml);
    expect(result.sections[0]?.blocks[0]).toEqual({
      kind: "skip-with-warning",
      reason: "equation",
    });
  });
});

/* ------------------------------------------------------------------ */
/*   Track changes                                                    */
/* ------------------------------------------------------------------ */

describe("parseBodyXml — track changes", () => {
  it("keeps <w:ins> content (accepted)", () => {
    const xml = doc(
      p(
        r(t("kept ")),
        `<w:ins w:id="0" w:author="x" w:date="2026-01-01">${r(t("inserted"))}</w:ins>`,
      ),
    );
    const para = parseBodyXml(xml).sections[0]?.blocks[0] as Paragraph;
    expect(para.runs.map((rn) => rn.text)).toEqual(["kept ", "inserted"]);
  });

  it("drops <w:del> content (rejected)", () => {
    const xml = doc(
      p(
        r(t("kept ")),
        `<w:del w:id="0" w:author="x" w:date="2026-01-01">${r(t("removed"))}</w:del>`,
        r(t(" after")),
      ),
    );
    const para = parseBodyXml(xml).sections[0]?.blocks[0] as Paragraph;
    expect(para.runs.map((rn) => rn.text)).toEqual(["kept ", " after"]);
  });
});
