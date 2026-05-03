import { describe, expect, it } from "vitest";
import engine from "./index";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function makeFile(name: string, type: string, sizeBytes = 1024): File {
  // The browser's File constructor takes Blob-like parts; we use a
  // small Uint8Array sized to `sizeBytes` so the file.size property
  // is honored (jsdom).
  const bytes = new Uint8Array(sizeBytes);
  return new File([bytes], name, { type });
}

describe("docx-to-pdf engine descriptor", () => {
  it("declares the expected metadata", () => {
    expect(engine.id).toBe("docx-to-pdf");
    expect(engine.cardinality).toBe("single");
    expect(engine.inputAccept).toEqual([".docx"]);
    expect(engine.inputMime).toContain(DOCX_MIME);
    expect(engine.outputMime).toBe("application/pdf");
  });

  it("has empty default options", () => {
    expect(engine.defaultOptions).toEqual({});
  });
});

describe("docx-to-pdf engine.validate", () => {
  it("accepts a file with the DOCX MIME type", () => {
    const f = makeFile("resume.docx", DOCX_MIME);
    expect(engine.validate(f, {})).toEqual({ ok: true });
  });

  it("accepts a file with the .docx extension regardless of mime", () => {
    const f = makeFile("resume.docx", "");
    expect(engine.validate(f, {})).toEqual({ ok: true });
  });

  it("accepts the .docx extension case-insensitively", () => {
    const f = makeFile("resume.DOCX", "");
    expect(engine.validate(f, {})).toEqual({ ok: true });
  });

  it("rejects files without DOCX mime and without .docx extension", () => {
    const f = makeFile("notes.txt", "text/plain");
    expect(engine.validate(f, {})).toEqual({ ok: false, reason: "Expected a .docx file" });
  });

  it("rejects PDFs even though they look like Office docs", () => {
    const f = makeFile("doc.pdf", "application/pdf");
    expect(engine.validate(f, {})).toEqual({ ok: false, reason: "Expected a .docx file" });
  });

  it("rejects DOCX files larger than the 100 MB cap", () => {
    const f = makeFile("huge.docx", DOCX_MIME, 100 * 1024 * 1024 + 1);
    expect(engine.validate(f, {})).toEqual({ ok: false, reason: "File exceeds 100 MB" });
  });

  it("accepts a DOCX file at exactly the 100 MB cap", () => {
    const f = makeFile("at-limit.docx", DOCX_MIME, 100 * 1024 * 1024);
    expect(engine.validate(f, {})).toEqual({ ok: true });
  });
});

describe("docx-to-pdf engine.convert", () => {
  it("is a function (worker integration is exercised by E2E + layout/index.test.ts)", () => {
    expect(typeof engine.convert).toBe("function");
  });
});
