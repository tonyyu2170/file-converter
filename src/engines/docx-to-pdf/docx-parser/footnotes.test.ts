import { describe, expect, it } from "vitest";

import { parseFootnotesXml } from "./footnotes";
import type { Paragraph } from "./types";

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const HDR = `<?xml version="1.0" encoding="UTF-8"?>`;

function footnotesXml(...inner: string[]): string {
  return `${HDR}<w:footnotes ${W_NS}>${inner.join("")}</w:footnotes>`;
}

function endnotesXml(...inner: string[]): string {
  return `${HDR}<w:endnotes ${W_NS}>${inner.join("")}</w:endnotes>`;
}

function fn(id: string, body: string, type?: string): string {
  const typeAttr = type !== undefined ? ` w:type="${type}"` : "";
  return `<w:footnote w:id="${id}"${typeAttr}>${body}</w:footnote>`;
}

function en(id: string, body: string, type?: string): string {
  const typeAttr = type !== undefined ? ` w:type="${type}"` : "";
  return `<w:endnote w:id="${id}"${typeAttr}>${body}</w:endnote>`;
}

const SIMPLE_PARA = `<w:p><w:r><w:t xml:space="preserve">Hello</w:t></w:r></w:p>`;

describe("parseFootnotesXml — footnotes", () => {
  it("returns an empty map for empty XML", () => {
    const r = parseFootnotesXml("");
    expect(r.value.size).toBe(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("returns an empty map when <w:footnotes> root is missing", () => {
    const r = parseFootnotesXml(`${HDR}<w:other ${W_NS}/>`);
    expect(r.value.size).toBe(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("parses a single footnote with one paragraph", () => {
    const r = parseFootnotesXml(footnotesXml(fn("1", SIMPLE_PARA)));
    expect(r.value.size).toBe(1);
    const blocks = r.value.get("1");
    expect(blocks).toHaveLength(1);
    const para = blocks?.[0] as Paragraph;
    expect(para.runs[0]?.text).toBe("Hello");
  });

  it("parses multiple footnotes keyed by id", () => {
    const r = parseFootnotesXml(
      footnotesXml(
        fn("1", "<w:p><w:r><w:t>one</w:t></w:r></w:p>"),
        fn("2", "<w:p><w:r><w:t>two</w:t></w:r></w:p>"),
        fn("3", "<w:p><w:r><w:t>three</w:t></w:r></w:p>"),
      ),
    );
    expect(r.value.size).toBe(3);
    expect((r.value.get("1")?.[0] as Paragraph).runs[0]?.text).toBe("one");
    expect((r.value.get("2")?.[0] as Paragraph).runs[0]?.text).toBe("two");
    expect((r.value.get("3")?.[0] as Paragraph).runs[0]?.text).toBe("three");
  });

  it("filters out separator pseudo-entries", () => {
    const r = parseFootnotesXml(
      footnotesXml(
        fn("-1", SIMPLE_PARA, "separator"),
        fn("0", SIMPLE_PARA, "continuationSeparator"),
        fn("1", SIMPLE_PARA),
      ),
    );
    expect(r.value.size).toBe(1);
    expect(r.value.has("1")).toBe(true);
    expect(r.value.has("-1")).toBe(false);
    expect(r.value.has("0")).toBe(false);
  });

  it("parses multi-paragraph footnote bodies", () => {
    const r = parseFootnotesXml(
      footnotesXml(
        fn("1", "<w:p><w:r><w:t>line1</w:t></w:r></w:p><w:p><w:r><w:t>line2</w:t></w:r></w:p>"),
      ),
    );
    expect(r.value.get("1")).toHaveLength(2);
  });
});

describe("parseFootnotesXml — endnotes", () => {
  it('parses <w:endnotes>/<w:endnote> shape via kind="endnote"', () => {
    const r = parseFootnotesXml(
      endnotesXml(en("1", "<w:p><w:r><w:t>endnote 1</w:t></w:r></w:p>")),
      "endnote",
    );
    expect(r.value.size).toBe(1);
    expect((r.value.get("1")?.[0] as Paragraph).runs[0]?.text).toBe("endnote 1");
  });

  it('returns empty map when XML uses footnote shape but kind="endnote"', () => {
    const r = parseFootnotesXml(footnotesXml(fn("1", SIMPLE_PARA)), "endnote");
    expect(r.value.size).toBe(0);
  });
});
