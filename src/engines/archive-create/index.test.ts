import { describe, expect, it } from "vitest";
import engine from "./index";

describe("archive-create engine descriptor", () => {
  it("declares cardinality, category", () => {
    expect(engine.id).toBe("archive-create");
    expect(engine.cardinality).toBe("multi");
    expect(engine.category).toBe("archive");
    expect(engine.archiveSuffix).toBeUndefined();
  });

  it("rejects empty file list", () => {
    expect(engine.validate([], engine.defaultOptions).ok).toBe(false);
  });

  it("accepts a single file", () => {
    const result = engine.validate([new File(["x"], "a.txt")], engine.defaultOptions);
    expect(result.ok).toBe(true);
  });

  it("rejects 600 MB sum", () => {
    const big = new File([new Uint8Array(1)], "big.bin");
    Object.defineProperty(big, "size", { value: 600 * 1_000_000 });
    const result = engine.validate([big], engine.defaultOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/limit 500 MB/);
  });

  it("isReadyToConvert mirrors filename validation", () => {
    expect(engine.isReadyToConvert?.({ outputFormat: "zip", filename: "ok" })).toBe(true);
    expect(engine.isReadyToConvert?.({ outputFormat: "zip", filename: "" })).toBe(false);
  });
});
