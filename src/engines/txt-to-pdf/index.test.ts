import { describe, expect, it } from "vitest";
import engine from "./index";

describe("txt-to-pdf engine metadata", () => {
  it("declares correct id, accept, MIME, category", () => {
    expect(engine.id).toBe("txt-to-pdf");
    expect(engine.inputAccept).toEqual([".txt"]);
    expect(engine.outputMime).toBe("application/pdf");
    expect(engine.cardinality).toBe("single");
    expect(engine.category).toBe("document");
    expect(engine.defaultOptions).toEqual({ pageSize: "letter" });
  });

  it("declares an OptionsPanel component", () => {
    expect(engine.OptionsPanel).toBeDefined();
  });

  it("validates text/plain MIME", () => {
    const txt = new File([new Uint8Array(0)], "x.txt", { type: "text/plain" });
    expect(engine.validate(txt, engine.defaultOptions)).toEqual({ ok: true });
  });

  it("validates by extension when MIME is empty", () => {
    const txt = new File([new Uint8Array(0)], "x.txt", { type: "" });
    expect(engine.validate(txt, engine.defaultOptions)).toEqual({ ok: true });
  });

  it("rejects files with wrong extension and MIME", () => {
    const pdf = new File([new Uint8Array(0)], "x.pdf", {
      type: "application/pdf",
    });
    const result = engine.validate(pdf, engine.defaultOptions);
    expect(result.ok).toBe(false);
  });
});
