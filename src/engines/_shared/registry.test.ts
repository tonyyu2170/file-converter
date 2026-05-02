import { describe, expect, it } from "vitest";
import { listEngineIds, loadEngine } from "./registry";

describe("registry", () => {
  it("lists engine ids including image-convert", () => {
    expect(listEngineIds()).toContain("image-convert");
  });

  it("loadEngine throws for unknown id", async () => {
    await expect(loadEngine("does-not-exist" as never)).rejects.toThrow("Unknown engine id");
  });

  it("loadEngine returns the image-convert engine module", async () => {
    const e = await loadEngine("image-convert");
    expect(e.id).toBe("image-convert");
    expect(e.cardinality).toBe("single");
  });

  it("loadEngine returns the image-to-pdf engine module", async () => {
    const e = await loadEngine("image-to-pdf");
    expect(e.id).toBe("image-to-pdf");
    expect(e.cardinality).toBe("multi");
  });

  it("loadEngine returns the pdf-merge engine module", async () => {
    const e = await loadEngine("pdf-merge");
    expect(e.id).toBe("pdf-merge");
    expect(e.cardinality).toBe("multi");
  });

  it("loadEngine returns the pdf-split engine module", async () => {
    const e = await loadEngine("pdf-split");
    expect(e.id).toBe("pdf-split");
    expect(e.cardinality).toBe("single");
  });
});
