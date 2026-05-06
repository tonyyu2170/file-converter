import { describe, expect, it } from "vitest";
import { editedFilename } from "./filenames";

describe("editedFilename", () => {
  it("appends -edited before .pdf", () => {
    expect(editedFilename("doc.pdf")).toBe("doc-edited.pdf");
  });
  it("handles names with multiple dots", () => {
    expect(editedFilename("my.report.v2.pdf")).toBe("my.report.v2-edited.pdf");
  });
  it("handles names without an extension", () => {
    expect(editedFilename("doc")).toBe("doc-edited.pdf");
  });
  it("handles names with .PDF (uppercase)", () => {
    expect(editedFilename("doc.PDF")).toBe("doc-edited.pdf");
  });
  it("does not double-suffix already-edited names", () => {
    expect(editedFilename("doc-edited.pdf")).toBe("doc-edited.pdf");
  });
  it("handles empty / whitespace defensively", () => {
    expect(editedFilename("")).toBe("edited.pdf");
    expect(editedFilename(".pdf")).toBe("edited.pdf");
  });
});
