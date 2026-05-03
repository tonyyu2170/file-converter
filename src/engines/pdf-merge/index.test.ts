import { describe, expect, it } from "vitest";
import engine from "./index";

describe("pdf-merge engine metadata", () => {
  it("declares correct id, accept lists, and cardinality", () => {
    expect(engine.id).toBe("pdf-merge");
    expect(engine.inputAccept).toEqual([".pdf"]);
    expect(engine.inputMime).toEqual(["application/pdf"]);
    expect(engine.cardinality).toBe("multi");
    expect(engine.outputMime).toBe("application/pdf");
    expect(engine.convertButtonLabel).toBe("[ merge pdfs ]");
  });

  it("declares a StagingArea but no OptionsPanel", () => {
    expect(engine.StagingArea).toBeDefined();
    expect(engine.OptionsPanel).toBeUndefined();
  });

  it("rejects an empty file list", () => {
    const r = engine.validate([], engine.defaultOptions);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/at least one/i);
  });

  it("rejects a single PDF (need 2+)", () => {
    const f = new File([new Uint8Array([1])], "a.pdf", { type: "application/pdf" });
    const r = engine.validate([f], engine.defaultOptions);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/2\+/);
  });

  it("accepts 2 PDFs", () => {
    const a = new File([new Uint8Array([1])], "a.pdf", { type: "application/pdf" });
    const b = new File([new Uint8Array([1])], "b.pdf", { type: "application/pdf" });
    const r = engine.validate([a, b], engine.defaultOptions);
    expect(r.ok).toBe(true);
  });

  it("rejects non-PDF in the set", () => {
    const a = new File([new Uint8Array([1])], "a.pdf", { type: "application/pdf" });
    const b = new File([new Uint8Array([1])], "b.png", { type: "image/png" });
    const r = engine.validate([a, b], engine.defaultOptions);
    expect(r.ok).toBe(false);
  });

  it("isReadyToConvert returns false when fewer than 2 rows", () => {
    const ready = engine.isReadyToConvert?.({ rows: [] });
    expect(ready).toBe(false);
  });

  it("isReadyToConvert returns false when any row is encrypted", () => {
    const ready = engine.isReadyToConvert?.({
      rows: [
        {
          id: "r1",
          fileName: "a.pdf",
          pageCount: 5,
          encrypted: false,
          rangeInput: "",
          parsedRange: [0, 1, 2, 3, 4],
          rangeError: undefined,
        },
        {
          id: "r2",
          fileName: "b.pdf",
          pageCount: 0,
          encrypted: true,
          rangeInput: "",
          parsedRange: [],
          rangeError: undefined,
        },
      ],
    });
    expect(ready).toBe(false);
  });

  it("isReadyToConvert returns false when any row has rangeError", () => {
    const ready = engine.isReadyToConvert?.({
      rows: [
        {
          id: "r1",
          fileName: "a.pdf",
          pageCount: 5,
          encrypted: false,
          rangeInput: "7-10",
          parsedRange: [],
          rangeError: "page 7 exceeds 5",
        },
        {
          id: "r2",
          fileName: "b.pdf",
          pageCount: 5,
          encrypted: false,
          rangeInput: "",
          parsedRange: [0, 1, 2, 3, 4],
          rangeError: undefined,
        },
      ],
    });
    expect(ready).toBe(false);
  });

  it("estimateOutputBytes returns null when fewer than 2 files", () => {
    expect(engine.estimateOutputBytes?.([], engine.defaultOptions)).toBe(null);
    const a = new File([new Uint8Array(100)], "a.pdf", { type: "application/pdf" });
    expect(engine.estimateOutputBytes?.([a], engine.defaultOptions)).toBe(null);
  });

  it("estimateOutputBytes returns the sum of input sizes for 2+ files", () => {
    const a = new File([new Uint8Array(100)], "a.pdf", { type: "application/pdf" });
    const b = new File([new Uint8Array(250)], "b.pdf", { type: "application/pdf" });
    const c = new File([new Uint8Array(750)], "c.pdf", { type: "application/pdf" });
    expect(engine.estimateOutputBytes?.([a, b], engine.defaultOptions)).toBe(350);
    expect(engine.estimateOutputBytes?.([a, b, c], engine.defaultOptions)).toBe(1100);
  });

  it("isReadyToConvert returns true when all rows are valid", () => {
    const ready = engine.isReadyToConvert?.({
      rows: [
        {
          id: "r1",
          fileName: "a.pdf",
          pageCount: 5,
          encrypted: false,
          rangeInput: "",
          parsedRange: [0, 1, 2, 3, 4],
          rangeError: undefined,
        },
        {
          id: "r2",
          fileName: "b.pdf",
          pageCount: 3,
          encrypted: false,
          rangeInput: "1-2",
          parsedRange: [0, 1],
          rangeError: undefined,
        },
      ],
    });
    expect(ready).toBe(true);
  });
});
