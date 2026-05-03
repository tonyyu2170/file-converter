import { describe, expect, it } from "vitest";

import { parseFooterXml, parseHeaderXml } from "./headers-footers";
import type { Paragraph, Table } from "./types";

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const HDR = `<?xml version="1.0" encoding="UTF-8"?>`;

function header(...inner: string[]): string {
  return `${HDR}<w:hdr ${W_NS}>${inner.join("")}</w:hdr>`;
}

function footer(...inner: string[]): string {
  return `${HDR}<w:ftr ${W_NS}>${inner.join("")}</w:ftr>`;
}

const SIMPLE_PARA = `<w:p><w:r><w:t xml:space="preserve">Hello</w:t></w:r></w:p>`;

describe("parseHeaderXml", () => {
  it("returns empty + warning for malformed XML", () => {
    const r = parseHeaderXml("<not-well-formed");
    expect(r.value).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("returns empty + warning when root is not <w:hdr>", () => {
    const r = parseHeaderXml(`${HDR}<w:other ${W_NS}/>`);
    expect(r.value).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("parses a header with a single paragraph", () => {
    const r = parseHeaderXml(header(SIMPLE_PARA));
    expect(r.value).toHaveLength(1);
    expect((r.value[0] as Paragraph).runs[0]?.text).toBe("Hello");
  });

  it("parses multiple paragraphs in document order", () => {
    const r = parseHeaderXml(
      header(
        "<w:p><w:r><w:t>one</w:t></w:r></w:p>",
        "<w:p><w:r><w:t>two</w:t></w:r></w:p>",
        "<w:p><w:r><w:t>three</w:t></w:r></w:p>",
      ),
    );
    expect(r.value).toHaveLength(3);
    expect((r.value[0] as Paragraph).runs[0]?.text).toBe("one");
    expect((r.value[2] as Paragraph).runs[0]?.text).toBe("three");
  });

  it("parses headers containing tables", () => {
    const r = parseHeaderXml(
      header(
        `<w:tbl><w:tblGrid><w:gridCol w:w="100"/></w:tblGrid><w:tr><w:tc>${SIMPLE_PARA}</w:tc></w:tr></w:tbl>`,
      ),
    );
    expect(r.value).toHaveLength(1);
    expect(r.value[0]?.kind).toBe("table");
    expect((r.value[0] as Table).rows).toHaveLength(1);
  });
});

describe("parseFooterXml", () => {
  it("returns empty + warning for malformed XML", () => {
    const r = parseFooterXml("<not-well-formed");
    expect(r.value).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("returns empty + warning when root is not <w:ftr>", () => {
    const r = parseFooterXml(`${HDR}<w:hdr ${W_NS}/>`);
    expect(r.value).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("parses a footer with a single paragraph", () => {
    const r = parseFooterXml(footer(SIMPLE_PARA));
    expect(r.value).toHaveLength(1);
    expect((r.value[0] as Paragraph).runs[0]?.text).toBe("Hello");
  });

  it("parses footers containing centered text", () => {
    const r = parseFooterXml(
      footer(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Confidential</w:t></w:r></w:p>`),
    );
    expect(r.value).toHaveLength(1);
    const para = r.value[0] as Paragraph;
    expect(para.alignment).toBe("center");
    expect(para.runs[0]?.text).toBe("Confidential");
  });
});
