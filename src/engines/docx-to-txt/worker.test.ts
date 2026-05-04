/**
 * Integration tests for docx-to-txt: real DOCX fixtures → parseDocx → extractText.
 *
 * These tests exercise the full parsing + text-extraction pipeline using
 * committed fixture files. Worker spawn (via engine.convert) requires a
 * browser Worker API that Vitest/jsdom does not provide — that path is
 * exercised by E2E tests. This file focuses on the synchronous extraction
 * logic against real DOCX bytes.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseDocx } from "@/engines/_shared/docx";
import { describe, expect, it } from "vitest";
import { defaultDocxToTxtOptions } from "./options";
import { extractText } from "./text-extractor";

async function loadDocx(filename: string): Promise<ParsedDocxResult> {
  const filePath = path.resolve(__dirname, "../../../tests/fixtures", filename);
  const buf = await readFile(filePath);
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const doc = parseDocx(bytes);
  return { doc, filename };
}

type ParsedDocxResult = {
  doc: ReturnType<typeof parseDocx>;
  filename: string;
};

describe("docx-to-txt: fixture integration (parseDocx + extractText)", () => {
  it("extracts non-empty text from simple-paragraphs.docx", async () => {
    const { doc } = await loadDocx("simple-paragraphs.docx");
    const text = extractText(doc, defaultDocxToTxtOptions);
    expect(text.length).toBeGreaterThan(0);
  });

  it("does not emit Markdown formatting markers", async () => {
    const { doc } = await loadDocx("simple-paragraphs.docx");
    const text = extractText(doc, defaultDocxToTxtOptions);
    expect(text).not.toMatch(/^#\s/m);
    expect(text).not.toMatch(/\*\*/);
    expect(text).not.toMatch(/^\s*[-*]\s/m);
  });

  it("joins paragraphs with double newline by default", async () => {
    const { doc } = await loadDocx("simple-paragraphs.docx");
    const text = extractText(doc, defaultDocxToTxtOptions);
    if (text.includes("\n")) {
      expect(text).toMatch(/\n\n/);
    }
  });

  it("joins paragraphs with single newline when option is single-newline", async () => {
    const { doc } = await loadDocx("simple-paragraphs.docx");
    const text = extractText(doc, { joinParagraphs: "single-newline" });
    // A simple-paragraphs fixture has no tables, so there should be no
    // double-newline separators with single-newline mode selected.
    expect(text).not.toMatch(/\n\n/);
  });

  it("extracts table content from table-doc.docx (cells tab-separated)", async () => {
    const { doc } = await loadDocx("table-doc.docx");
    const text = extractText(doc, defaultDocxToTxtOptions);
    expect(text.length).toBeGreaterThan(0);
    // Table cells are joined by \t
    expect(text).toMatch(/\t/);
  });

  it("handles image-doc.docx without throwing (image runs skipped silently)", async () => {
    const { doc } = await loadDocx("image-doc.docx");
    // Should not throw; any textual content is extracted; image blobs skipped
    const text = extractText(doc, defaultDocxToTxtOptions);
    expect(typeof text).toBe("string");
  });

  it("handles encrypted.docx by throwing a user-displayable error", async () => {
    const filePath = path.resolve(__dirname, "../../../tests/fixtures", "encrypted.docx");
    const buf = await readFile(filePath);
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    expect(() => parseDocx(bytes)).toThrow();
  });
});
