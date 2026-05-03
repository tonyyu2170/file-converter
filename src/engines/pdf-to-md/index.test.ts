import { describe, expect, it } from "vitest";
import engine from "./index";
import { defaultPdfToMdOptions } from "./options";
import { PdfToMdOptionsPanel } from "./options-panel";

describe("pdf-to-md engine metadata", () => {
  it("declares correct id, accept lists, and cardinality", () => {
    expect(engine.id).toBe("pdf-to-md");
    expect(engine.inputAccept).toEqual([".pdf"]);
    expect(engine.inputMime).toEqual(["application/pdf"]);
    expect(engine.cardinality).toBe("single");
    expect(engine.outputMime).toBe("text/markdown");
  });

  it("does not declare archiveSuffix (single-output engine)", () => {
    expect(engine.archiveSuffix).toBeUndefined();
  });

  it("uses defaultPdfToMdOptions as defaultOptions", () => {
    expect(engine.defaultOptions).toBe(defaultPdfToMdOptions);
    expect(engine.defaultOptions.pageBreaks).toBe("horizontal-rule");
  });

  it("wires PdfToMdOptionsPanel as the OptionsPanel", () => {
    expect(engine.OptionsPanel).toBe(PdfToMdOptionsPanel);
  });

  it("accepts a PDF by MIME", () => {
    const f = new File([new Uint8Array([1])], "doc.pdf", { type: "application/pdf" });
    const r = engine.validate(f, engine.defaultOptions);
    expect(r.ok).toBe(true);
  });

  it("accepts a PDF by extension fallback (no MIME)", () => {
    const f = new File([new Uint8Array([1])], "doc.pdf", { type: "" });
    const r = engine.validate(f, engine.defaultOptions);
    expect(r.ok).toBe(true);
  });

  it("accepts a PDF by uppercase extension fallback (.PDF)", () => {
    const f = new File([new Uint8Array([1])], "Annual_Report_2025.PDF", { type: "" });
    const r = engine.validate(f, engine.defaultOptions);
    expect(r.ok).toBe(true);
  });

  it("rejects a non-PDF file", () => {
    const f = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    const r = engine.validate(f, engine.defaultOptions);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/PDF/i);
  });

  it("rejects a file with no PDF extension and unrelated MIME", () => {
    const f = new File([new Uint8Array([1])], "notes.txt", { type: "text/plain" });
    const r = engine.validate(f, engine.defaultOptions);
    expect(r.ok).toBe(false);
  });

  it("isReadyToConvert returns true with default options", () => {
    expect(engine.isReadyToConvert?.(engine.defaultOptions)).toBe(true);
  });

  it("isReadyToConvert returns true with pageBreaks 'none'", () => {
    expect(engine.isReadyToConvert?.({ pageBreaks: "none" })).toBe(true);
  });
});
