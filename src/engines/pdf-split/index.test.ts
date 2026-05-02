import { describe, expect, it } from "vitest";
import engine from "./index";

describe("pdf-split engine metadata", () => {
  it("declares correct id, accept lists, and cardinality", () => {
    expect(engine.id).toBe("pdf-split");
    expect(engine.inputAccept).toEqual([".pdf"]);
    expect(engine.inputMime).toEqual(["application/pdf"]);
    expect(engine.cardinality).toBe("single");
    expect(engine.outputMime).toBe("application/pdf");
  });

  it("declares archiveSuffix '-split'", () => {
    expect(engine.archiveSuffix).toBe("-split");
  });

  it("rejects a non-PDF file", () => {
    const f = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
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

  it("isReadyToConvert returns false on empty rangeInput", () => {
    expect(engine.isReadyToConvert?.({ rangeInput: "" })).toBe(false);
  });

  it("isReadyToConvert returns false on whitespace-only rangeInput", () => {
    expect(engine.isReadyToConvert?.({ rangeInput: "   " })).toBe(false);
  });

  it("isReadyToConvert returns true on non-empty rangeInput", () => {
    expect(engine.isReadyToConvert?.({ rangeInput: "1-3" })).toBe(true);
  });
});
