import { describe, expect, it } from "vitest";
import engine from "./index";

describe("docx-to-txt engine metadata", () => {
  it("declares correct id, accept, MIME, category", () => {
    expect(engine.id).toBe("docx-to-txt");
    expect(engine.inputAccept).toEqual([".docx"]);
    expect(engine.inputMime).toEqual([
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]);
    expect(engine.outputMime).toBe("text/plain");
    expect(engine.cardinality).toBe("single");
    expect(engine.category).toBe("document");
    expect(engine.defaultOptions).toEqual({ joinParagraphs: "double-newline" });
  });

  it("declares an OptionsPanel component", () => {
    expect(engine.OptionsPanel).toBeDefined();
  });

  it("validates DOCX MIME", () => {
    const docx = new File([new Uint8Array(0)], "x.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const txt = new File([new Uint8Array(0)], "x.txt", { type: "text/plain" });
    expect(engine.validate(docx, engine.defaultOptions)).toEqual({ ok: true });
    const result = engine.validate(txt, engine.defaultOptions);
    expect(result.ok).toBe(false);
  });
});
