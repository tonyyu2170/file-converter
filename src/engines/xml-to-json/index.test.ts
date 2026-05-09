// src/engines/xml-to-json/index.test.ts
import { describe, expect, it } from "vitest";
import engine from "./index";

describe("xml-to-json engine descriptor", () => {
  it("declares cardinality + category", () => {
    expect(engine.id).toBe("xml-to-json");
    expect(engine.cardinality).toBe("single");
    expect(engine.category).toBe("data");
  });

  it("validates .xml (lenient)", () => {
    expect(
      engine.validate(new File([], "x.xml", { type: "application/xml" }), engine.defaultOptions).ok,
    ).toBe(true);
    expect(engine.validate(new File([], "x.xml", { type: "" }), engine.defaultOptions).ok).toBe(
      true,
    );
    expect(
      engine.validate(new File([], "x.bin", { type: "text/xml" }), engine.defaultOptions).ok,
    ).toBe(true);
    expect(
      engine.validate(new File([], "x.json", { type: "application/json" }), engine.defaultOptions)
        .ok,
    ).toBe(false);
  });

  it("rejects > 50 MB", () => {
    const big = new File([new Uint8Array(1)], "big.xml", { type: "application/xml" });
    Object.defineProperty(big, "size", { value: 60 * 1_000_000 });
    expect(engine.validate(big, engine.defaultOptions).ok).toBe(false);
  });
});
