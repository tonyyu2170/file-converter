import { describe, expect, it } from "vitest";
import engine from "./index";
import { defaultPdfToImageOptions } from "./options";

describe("pdf-to-image engine metadata", () => {
  it("declares correct id, accept lists, and cardinality", () => {
    expect(engine.id).toBe("pdf-to-image");
    expect(engine.inputAccept).toEqual([".pdf"]);
    expect(engine.inputMime).toEqual(["application/pdf"]);
    expect(engine.cardinality).toBe("single");
    expect(engine.outputMime).toBe("image/png");
  });

  it("declares archiveSuffix '-images'", () => {
    expect(engine.archiveSuffix).toBe("-images");
  });

  it("exposes defaultOptions matching defaultPdfToImageOptions", () => {
    expect(engine.defaultOptions).toEqual(defaultPdfToImageOptions);
  });

  it("rejects a non-PDF file", () => {
    const f = new File([new Uint8Array([1])], "a.txt", { type: "text/plain" });
    const r = engine.validate(f, engine.defaultOptions);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/PDF/i);
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

  it("isReadyToConvert returns true on default options (empty range = all pages)", () => {
    expect(engine.isReadyToConvert?.(defaultPdfToImageOptions)).toBe(true);
  });

  it("isReadyToConvert returns true on non-empty rangeInput", () => {
    expect(engine.isReadyToConvert?.({ ...defaultPdfToImageOptions, rangeInput: "1-3" })).toBe(
      true,
    );
  });

  it("exposes an OptionsPanel component", () => {
    expect(engine.OptionsPanel).toBeDefined();
  });
});
