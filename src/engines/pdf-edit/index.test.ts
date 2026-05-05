import { describe, expect, it } from "vitest";
import engine from "./index";

describe("pdf-edit engine metadata", () => {
  it("declares correct id, cardinality, category, output", () => {
    expect(engine.id).toBe("pdf-edit");
    expect(engine.cardinality).toBe("single");
    expect(engine.category).toBe("pdf");
    expect(engine.outputMime).toBe("application/pdf");
  });

  it("declares library + license", () => {
    expect(engine.library).toMatch(/pdf-lib/);
    expect(engine.license).toBe("mixed");
  });

  it("validate accepts PDF MIME", () => {
    const v = engine.validate(
      new File([new Uint8Array(1)], "doc.pdf", { type: "application/pdf" }),
      engine.defaultOptions,
    );
    expect(v).toEqual({ ok: true });
  });

  it("validate accepts .pdf extension fallback (empty MIME)", () => {
    const v = engine.validate(
      new File([new Uint8Array(1)], "doc.pdf", { type: "" }),
      engine.defaultOptions,
    );
    expect(v).toEqual({ ok: true });
  });

  it("validate rejects non-PDF type", () => {
    const v = engine.validate(
      new File([new Uint8Array(1)], "doc.txt", { type: "text/plain" }),
      engine.defaultOptions,
    );
    expect(v.ok).toBe(false);
  });

  it("validate rejects empty file", () => {
    const v = engine.validate(
      new File([], "doc.pdf", { type: "application/pdf" }),
      engine.defaultOptions,
    );
    expect(v.ok).toBe(false);
  });

  it("validate rejects file above 250 MB hard cap", () => {
    const big = new File([new Uint8Array(251_000_000)], "big.pdf", {
      type: "application/pdf",
    });
    const v = engine.validate(big, engine.defaultOptions);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/250 MB/);
  });

  it("isReadyToConvert returns false on default options (no pages seeded yet)", () => {
    expect(engine.isReadyToConvert?.(engine.defaultOptions)).toBe(false);
  });

  it("isReadyToConvert returns false when all pages are deleted", () => {
    expect(engine.isReadyToConvert?.({ pages: [], totalSourcePages: 5 })).toBe(false);
  });
});
