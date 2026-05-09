// src/engines/json-format/index.test.ts
import { describe, expect, it } from "vitest";
import engine from "./index";

describe("json-format engine descriptor", () => {
  it("declares cardinality + category", () => {
    expect(engine.id).toBe("json-format");
    expect(engine.cardinality).toBe("single");
    expect(engine.category).toBe("data");
    expect(engine.archiveSuffix).toBeUndefined();
  });

  it("validates .json (lenient ext OR MIME)", () => {
    expect(
      engine.validate(new File([], "x.json", { type: "application/json" }), engine.defaultOptions)
        .ok,
    ).toBe(true);
    expect(engine.validate(new File([], "x.json", { type: "" }), engine.defaultOptions).ok).toBe(
      true,
    );
    expect(
      engine.validate(new File([], "x.txt", { type: "application/json" }), engine.defaultOptions)
        .ok,
    ).toBe(true);
    expect(
      engine.validate(new File([], "x.txt", { type: "text/plain" }), engine.defaultOptions).ok,
    ).toBe(false);
  });

  it("rejects > 50 MB", () => {
    const big = new File([new Uint8Array(1)], "big.json", { type: "application/json" });
    Object.defineProperty(big, "size", { value: 60 * 1_000_000 });
    expect(engine.validate(big, engine.defaultOptions).ok).toBe(false);
  });
});
