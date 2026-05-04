/**
 * Integration tests for `parseDocx`. Each committed DOCX fixture under
 * `tests/fixtures/` is parsed end-to-end and asserted against expected
 * structural properties — section count, paragraph counts, presence /
 * absence of features, warning content for skip fixtures, error throws
 * for the encrypted fixture.
 *
 * Fixtures (per spec §9.4):
 *   simple-paragraphs.docx   1-page, headings + body
 *   multi-page.docx          5 pages of paragraphs
 *   two-column-resume.docx   2-column section
 *   table-doc.docx           tables w/ gridSpan
 *   headed-footed.docx       header + footer
 *   footnoted.docx           3 footnotes
 *   nested-list.docx         3-level bulleted + 2-level numbered
 *   image-doc.docx           inline PNG + JPEG
 *   equations-doc.docx       OMML equation (skip)
 *   drawings-doc.docx        DrawingML shape (skip)
 *   rtl-doc.docx             RTL paragraph (skip)
 *   encrypted.docx           password-protected (throws)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { ENCRYPTED_DOCX_MESSAGE, NOT_A_DOCX_MESSAGE, parseDocx } from "./index";
import type { Paragraph, Run, Table } from "./types";

const FIXTURES_DIR = join(process.cwd(), "tests", "fixtures");

function readFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
}

/** Returns a flat list of paragraphs across all sections for assertions. */
function allParagraphs(parsed: ReturnType<typeof parseDocx>): Paragraph[] {
  const out: Paragraph[] = [];
  for (const section of parsed.sections) {
    for (const block of section.blocks) {
      if (block.kind === "paragraph") out.push(block);
      else if (block.kind === "table") {
        for (const row of block.rows) {
          for (const cell of row.cells) {
            for (const inner of cell.blocks) {
              if (inner.kind === "paragraph") out.push(inner);
            }
          }
        }
      }
    }
  }
  return out;
}

function paragraphText(p: Paragraph): string {
  return p.runs.map((r: Run) => r.text).join("");
}

describe("parseDocx — error cases", () => {
  it('throws "password-protected" for encrypted.docx', () => {
    expect(() => parseDocx(readFixture("encrypted.docx"))).toThrow(ENCRYPTED_DOCX_MESSAGE);
  });

  it('throws "missing word/document.xml" for non-DOCX bytes', () => {
    // 4 bytes of garbage — fails unzip; our error path still surfaces it
    // as the missing-document.xml UX.
    expect(() => parseDocx(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toThrow(NOT_A_DOCX_MESSAGE);
  });
});

describe("parseDocx — simple-paragraphs.docx", () => {
  const parsed = parseDocx(readFixture("simple-paragraphs.docx"));

  it("yields exactly one section", () => {
    expect(parsed.sections).toHaveLength(1);
  });

  it("contains five body blocks (paragraphs)", () => {
    expect(parsed.sections[0]?.blocks).toHaveLength(5);
    for (const b of parsed.sections[0]?.blocks ?? []) {
      expect(b.kind).toBe("paragraph");
    }
  });

  it("has a Heading1 paragraph for the title", () => {
    const headings = allParagraphs(parsed).filter((p) => p.styleId === "Heading1");
    expect(headings.length).toBeGreaterThanOrEqual(1);
  });

  it('preserves the fixture identifier text "Tony Yu"', () => {
    const fullText = allParagraphs(parsed).map(paragraphText).join("\n");
    expect(fullText).toContain("Tony Yu");
  });

  it("captures the bold/italic mixed-styling run", () => {
    const paras = allParagraphs(parsed);
    const styled = paras.find((p) => p.runs.some((r) => r.bold) && p.runs.some((r) => r.italic));
    expect(styled).toBeDefined();
  });

  it("emits no warnings", () => {
    expect(parsed.warnings).toEqual([]);
  });
});

describe("parseDocx — multi-page.docx", () => {
  const parsed = parseDocx(readFixture("multi-page.docx"));

  it("yields one section", () => {
    expect(parsed.sections).toHaveLength(1);
  });

  it("yields many paragraphs (>= 130 = 5×26 minimum)", () => {
    expect(parsed.sections[0]?.blocks.length).toBeGreaterThanOrEqual(130);
  });

  it("emits no warnings", () => {
    expect(parsed.warnings).toEqual([]);
  });
});

describe("parseDocx — two-column-resume.docx", () => {
  const parsed = parseDocx(readFixture("two-column-resume.docx"));

  it("yields a section with column count = 2", () => {
    expect(parsed.sections[0]?.columns.count).toBe(2);
  });

  it("preserves resume identity text", () => {
    const text = allParagraphs(parsed).map(paragraphText).join("\n");
    expect(text).toContain("Tony Yu");
    expect(text).toContain("Contact");
  });
});

describe("parseDocx — table-doc.docx", () => {
  const parsed = parseDocx(readFixture("table-doc.docx"));

  it("contains at least one table", () => {
    const tables = (parsed.sections[0]?.blocks ?? []).filter((b) => b.kind === "table");
    expect(tables.length).toBeGreaterThanOrEqual(1);
  });

  it("captures a cell with gridSpan > 1", () => {
    const tables = (parsed.sections[0]?.blocks ?? []).filter((b): b is Table => b.kind === "table");
    const hasSpan = tables.some((t) => t.rows.some((row) => row.cells.some((c) => c.gridSpan > 1)));
    expect(hasSpan).toBe(true);
  });

  it("paragraphs around the table preserve order", () => {
    const blocks = parsed.sections[0]?.blocks ?? [];
    const tableIdx = blocks.findIndex((b) => b.kind === "table");
    expect(tableIdx).toBeGreaterThan(0);
    expect(blocks[tableIdx + 1]?.kind).toBe("paragraph");
  });
});

describe("parseDocx — headed-footed.docx", () => {
  const parsed = parseDocx(readFixture("headed-footed.docx"));

  it("populates headers map with at least one entry", () => {
    expect(parsed.headers.size).toBeGreaterThanOrEqual(1);
  });

  it("populates footers map with at least one entry", () => {
    expect(parsed.footers.size).toBeGreaterThanOrEqual(1);
  });

  it("section's headerRefs.default points to a header relationship id", () => {
    const ref = parsed.sections[0]?.headerRefs.default;
    expect(ref).toBeDefined();
    if (ref !== undefined) {
      expect(parsed.relationships.has(ref)).toBe(true);
    }
  });

  it("section's footerRefs.default points to a footer relationship id", () => {
    const ref = parsed.sections[0]?.footerRefs.default;
    expect(ref).toBeDefined();
    if (ref !== undefined) {
      expect(parsed.relationships.has(ref)).toBe(true);
    }
  });

  it("captures the header's identifying text", () => {
    let found = false;
    for (const blocks of parsed.headers.values()) {
      for (const block of blocks) {
        if (block.kind !== "paragraph") continue;
        const text = block.runs.map((r) => r.text).join("");
        if (text.includes("Tony Yu") && text.includes("Phase 10")) found = true;
      }
    }
    expect(found).toBe(true);
  });
});

describe("parseDocx — footnoted.docx", () => {
  const parsed = parseDocx(readFixture("footnoted.docx"));

  it("populates footnotes map with three real entries", () => {
    expect(parsed.footnotes.size).toBe(3);
    expect(parsed.footnotes.has("1")).toBe(true);
    expect(parsed.footnotes.has("2")).toBe(true);
    expect(parsed.footnotes.has("3")).toBe(true);
  });

  it("captures footnoteRef on at least one body run", () => {
    let count = 0;
    for (const para of allParagraphs(parsed)) {
      for (const run of para.runs) {
        if (run.footnoteRef !== undefined) count += 1;
      }
    }
    expect(count).toBe(3);
  });

  it("footnote 1 contains the expected text", () => {
    const blocks = parsed.footnotes.get("1");
    expect(blocks).toBeDefined();
    const para = blocks?.[0] as Paragraph;
    expect(paragraphText(para)).toContain("First footnote");
  });
});

describe("parseDocx — nested-list.docx", () => {
  const parsed = parseDocx(readFixture("nested-list.docx"));

  it("populates the numbering map", () => {
    expect(parsed.numbering.size).toBeGreaterThanOrEqual(1);
  });

  it("contains paragraphs with numPr at multiple ilvl values", () => {
    const ilvls = new Set<number>();
    for (const para of allParagraphs(parsed)) {
      if (para.numPr !== undefined) ilvls.add(para.numPr.ilvl);
    }
    expect(ilvls.size).toBeGreaterThanOrEqual(2);
  });
});

describe("parseDocx — image-doc.docx", () => {
  const parsed = parseDocx(readFixture("image-doc.docx"));

  it("populates media map with at least one entry", () => {
    expect(parsed.media.size).toBeGreaterThanOrEqual(1);
  });

  it("captures inline images on body runs (rel + sized in pt)", () => {
    let count = 0;
    for (const para of allParagraphs(parsed)) {
      for (const run of para.runs) {
        if (run.inlineImage !== undefined) {
          count += 1;
          expect(run.inlineImage.rel).toMatch(/^rId\d+$/);
          expect(run.inlineImage.widthPt).toBeGreaterThan(0);
          expect(run.inlineImage.heightPt).toBeGreaterThan(0);
        }
      }
    }
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("media bytes have a recognized MIME (PNG or JPEG)", () => {
    for (const m of parsed.media.values()) {
      expect(["image/png", "image/jpeg"]).toContain(m.mime);
    }
  });
});

describe("parseDocx — equations-doc.docx", () => {
  const parsed = parseDocx(readFixture("equations-doc.docx"));

  it('emits at least one "equation" warning', () => {
    expect(parsed.warnings.some((w) => /equation/i.test(w))).toBe(true);
  });

  it("converts the equation paragraph to a skip-with-warning block", () => {
    const skips = (parsed.sections[0]?.blocks ?? []).filter((b) => b.kind === "skip-with-warning");
    expect(skips.length).toBeGreaterThanOrEqual(1);
  });
});

describe("parseDocx — drawings-doc.docx", () => {
  const parsed = parseDocx(readFixture("drawings-doc.docx"));

  it('emits at least one "drawing" warning', () => {
    expect(parsed.warnings.some((w) => /drawing/i.test(w))).toBe(true);
  });

  it("converts the drawing paragraph to a skip-with-warning block", () => {
    const skips = (parsed.sections[0]?.blocks ?? []).filter((b) => b.kind === "skip-with-warning");
    expect(skips.length).toBeGreaterThanOrEqual(1);
  });
});

describe("parseDocx — rtl-doc.docx", () => {
  const parsed = parseDocx(readFixture("rtl-doc.docx"));

  it('emits at least one "RTL" warning', () => {
    expect(parsed.warnings.some((w) => /RTL/i.test(w))).toBe(true);
  });

  it("converts the RTL paragraph to a skip-with-warning block", () => {
    const skips = (parsed.sections[0]?.blocks ?? []).filter((b) => b.kind === "skip-with-warning");
    expect(skips.length).toBeGreaterThanOrEqual(1);
  });
});

describe("parseDocx — leaf data wired through orchestrator", () => {
  const parsed = parseDocx(readFixture("simple-paragraphs.docx"));

  it("populates relationships map", () => {
    // simple-paragraphs has at least styles and theme rels.
    expect(parsed.relationships.size).toBeGreaterThanOrEqual(1);
  });

  it("populates styles map", () => {
    expect(parsed.styles.size).toBeGreaterThanOrEqual(1);
  });

  it("returns sections with default-shaped page setup", () => {
    expect(parsed.sections[0]?.pageSize.widthPt).toBeGreaterThan(0);
    expect(parsed.sections[0]?.pageSize.heightPt).toBeGreaterThan(0);
  });

  it("populates bookmarks set (empty for fixtures without bookmarkStart)", () => {
    // simple-paragraphs has no bookmarks; the field is still a real Set.
    expect(parsed.bookmarks).toBeInstanceOf(Set);
  });
});

/* ------------------------------------------------------------------ */
/*   Bookmark collection (Phase 13 / F2)                               */
/* ------------------------------------------------------------------ */

/**
 * Encode a UTF-8 string into a Uint8Array using the *fflate-realm*
 * Uint8Array constructor.
 *
 * Why: vitest's jsdom environment exposes a TextEncoder whose
 * `.encode(...)` returns a Uint8Array allocated in the jsdom realm. fflate
 * (loaded in the Node realm) checks `val instanceof Uint8Array` against
 * its own realm's constructor — that check fails for jsdom-realm typed
 * arrays, so fflate misclassifies the bytes as a sub-directory and emits
 * one entry per byte. Re-wrapping the buffer in a fresh Node-realm
 * Uint8Array sidesteps the cross-realm check. Production parser code is
 * fed bytes from the worker's own realm, so this only matters for tests.
 */
function utf8encode(s: string): Uint8Array {
  const enc = new TextEncoder().encode(s);
  return new Uint8Array(enc.buffer, enc.byteOffset, enc.byteLength);
}

/**
 * Build a minimal DOCX zip with a `[Content_Types].xml` + `word/document.xml`
 * + optional footnotes/headers/footers containing the supplied body fragment
 * inside `<w:body>`. Returns the bytes ready for `parseDocx`.
 */
function makeMinimalDocx(parts: {
  body?: string;
  footnotes?: string;
  endnotes?: string;
  header1?: string;
  footer1?: string;
}): Uint8Array {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const wDecl = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${wDecl}><w:body>${parts.body ?? ""}</w:body></w:document>`;

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": utf8encode(contentTypes),
    "word/document.xml": utf8encode(documentXml),
  };
  if (parts.footnotes !== undefined) {
    files["word/footnotes.xml"] = utf8encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes ${wDecl}>${parts.footnotes}</w:footnotes>`,
    );
  }
  if (parts.endnotes !== undefined) {
    files["word/endnotes.xml"] = utf8encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:endnotes ${wDecl}>${parts.endnotes}</w:endnotes>`,
    );
  }
  if (parts.header1 !== undefined) {
    files["word/header1.xml"] = utf8encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${wDecl}>${parts.header1}</w:hdr>`,
    );
  }
  if (parts.footer1 !== undefined) {
    files["word/footer1.xml"] = utf8encode(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${wDecl}>${parts.footer1}</w:ftr>`,
    );
  }
  return zipSync(files);
}

describe("parseDocx — bookmark collection", () => {
  it("collects <w:bookmarkStart w:name='...'/> declared in the body", () => {
    const bytes = makeMinimalDocx({
      body: '<w:p><w:bookmarkStart w:id="0" w:name="abc"/><w:r><w:t>hi</w:t></w:r></w:p>',
    });
    const parsed = parseDocx(bytes);
    expect(parsed.bookmarks.has("abc")).toBe(true);
  });

  it("collects bookmarks declared between paragraphs at body level", () => {
    const bytes = makeMinimalDocx({
      body: '<w:bookmarkStart w:id="0" w:name="top"/><w:p><w:r><w:t>x</w:t></w:r></w:p>',
    });
    const parsed = parseDocx(bytes);
    expect(parsed.bookmarks.has("top")).toBe(true);
  });

  it("collects bookmarks inside footnote bodies", () => {
    const bytes = makeMinimalDocx({
      body: "<w:p/>",
      footnotes:
        '<w:footnote w:id="1"><w:p><w:bookmarkStart w:id="0" w:name="fn-anchor"/></w:p></w:footnote>',
    });
    const parsed = parseDocx(bytes);
    expect(parsed.bookmarks.has("fn-anchor")).toBe(true);
  });

  it("collects bookmarks inside endnote bodies", () => {
    const bytes = makeMinimalDocx({
      body: "<w:p/>",
      endnotes:
        '<w:endnote w:id="1"><w:p><w:bookmarkStart w:id="0" w:name="en-anchor"/></w:p></w:endnote>',
    });
    const parsed = parseDocx(bytes);
    expect(parsed.bookmarks.has("en-anchor")).toBe(true);
  });

  it("collects bookmarks inside headers and footers", () => {
    const bytes = makeMinimalDocx({
      body: "<w:p/>",
      header1: '<w:p><w:bookmarkStart w:id="0" w:name="hdr-anchor"/></w:p>',
      footer1: '<w:p><w:bookmarkStart w:id="0" w:name="ftr-anchor"/></w:p>',
    });
    const parsed = parseDocx(bytes);
    expect(parsed.bookmarks.has("hdr-anchor")).toBe(true);
    expect(parsed.bookmarks.has("ftr-anchor")).toBe(true);
  });

  it("unions bookmarks from body + footnotes + endnotes + headers + footers", () => {
    const bytes = makeMinimalDocx({
      body: '<w:bookmarkStart w:id="0" w:name="body-bk"/><w:p/>',
      footnotes:
        '<w:footnote w:id="1"><w:p><w:bookmarkStart w:id="0" w:name="fn-bk"/></w:p></w:footnote>',
      endnotes:
        '<w:endnote w:id="1"><w:p><w:bookmarkStart w:id="0" w:name="en-bk"/></w:p></w:endnote>',
      header1: '<w:p><w:bookmarkStart w:id="0" w:name="hdr-bk"/></w:p>',
      footer1: '<w:p><w:bookmarkStart w:id="0" w:name="ftr-bk"/></w:p>',
    });
    const parsed = parseDocx(bytes);
    expect(parsed.bookmarks).toEqual(new Set(["body-bk", "fn-bk", "en-bk", "hdr-bk", "ftr-bk"]));
  });

  it("returns an empty set when no bookmarks are declared", () => {
    const bytes = makeMinimalDocx({ body: "<w:p><w:r><w:t>plain</w:t></w:r></w:p>" });
    const parsed = parseDocx(bytes);
    expect(parsed.bookmarks.size).toBe(0);
  });

  it("supports single- and double-quoted name attributes", () => {
    const bytes = makeMinimalDocx({
      body: `<w:bookmarkStart w:id="0" w:name="dq"/><w:bookmarkStart w:id='1' w:name='sq'/>`,
    });
    const parsed = parseDocx(bytes);
    expect(parsed.bookmarks.has("dq")).toBe(true);
    expect(parsed.bookmarks.has("sq")).toBe(true);
  });

  it("ignores bookmarkStart entries with no w:name attribute", () => {
    const bytes = makeMinimalDocx({
      body: '<w:bookmarkStart w:id="0"/><w:p/>',
    });
    const parsed = parseDocx(bytes);
    expect(parsed.bookmarks.size).toBe(0);
  });
});
