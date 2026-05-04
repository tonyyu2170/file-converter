import { describe, expect, it } from "vitest";
import engine from "./index";

describe("markdown-to-pdf engine metadata", () => {
  it("declares correct id, accept, MIME, category", () => {
    expect(engine.id).toBe("markdown-to-pdf");
    expect(engine.inputAccept).toEqual([".md", ".markdown"]);
    expect(engine.outputMime).toBe("application/pdf");
    expect(engine.cardinality).toBe("single");
    expect(engine.category).toBe("document");
    expect(engine.defaultOptions).toEqual({ pageSize: "letter" });
  });

  it("declares an OptionsPanel component", () => {
    expect(engine.OptionsPanel).toBeDefined();
  });

  it("validates by extension when MIME is empty", () => {
    const md = new File([new Uint8Array(0)], "x.md", { type: "" });
    expect(engine.validate(md, engine.defaultOptions)).toEqual({ ok: true });
  });

  it("validates explicit text/markdown MIME", () => {
    const md = new File([new Uint8Array(0)], "x.md", { type: "text/markdown" });
    expect(engine.validate(md, engine.defaultOptions)).toEqual({ ok: true });
  });

  it("rejects unsupported files", () => {
    const txt = new File([new Uint8Array(0)], "x.txt", {
      type: "text/plain",
    });
    const result = engine.validate(txt, engine.defaultOptions);
    expect(result.ok).toBe(false);
  });
});
