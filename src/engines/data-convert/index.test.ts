// src/engines/data-convert/index.test.ts
import { describe, expect, it } from "vitest";
import engine from "./index";

describe("data-convert engine descriptor", () => {
  it("declares cardinality + category + no archiveSuffix", () => {
    expect(engine.id).toBe("data-convert");
    expect(engine.cardinality).toBe("single");
    expect(engine.category).toBe("data");
    expect(engine.archiveSuffix).toBeUndefined();
  });

  it("validates by extension OR MIME (lenient)", () => {
    expect(
      engine.validate(new File([], "x.csv", { type: "text/csv" }), engine.defaultOptions).ok,
    ).toBe(true);
    expect(engine.validate(new File([], "x.csv", { type: "" }), engine.defaultOptions).ok).toBe(
      true,
    );
    expect(
      engine.validate(new File([], "x.bin", { type: "application/json" }), engine.defaultOptions)
        .ok,
    ).toBe(true);
    expect(engine.validate(new File([], "x.yaml", { type: "" }), engine.defaultOptions).ok).toBe(
      true,
    );
    expect(engine.validate(new File([], "x.yml", { type: "" }), engine.defaultOptions).ok).toBe(
      true,
    );
    expect(
      engine.validate(new File([], "x.xml", { type: "application/xml" }), engine.defaultOptions).ok,
    ).toBe(false);
  });

  it("rejects files > 50 MB", () => {
    const big = new File([new Uint8Array(1)], "big.csv", { type: "text/csv" });
    Object.defineProperty(big, "size", { value: 60 * 1_000_000 });
    const result = engine.validate(big, engine.defaultOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/limit 50 MB/);
  });
});
