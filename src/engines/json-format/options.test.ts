// src/engines/json-format/options.test.ts
import { describe, expect, it } from "vitest";
import { defaultJsonFormatOptions, indentArg } from "./options";

describe("JsonFormatOptions", () => {
  it("defaults to pretty + 2-space indent", () => {
    expect(defaultJsonFormatOptions).toEqual({ mode: "pretty", indent: 2 });
  });
  it("indentArg minify → 0", () => {
    expect(indentArg({ mode: "minify", indent: 2 })).toBe(0);
  });
  it("indentArg pretty + 2 → 2", () => {
    expect(indentArg({ mode: "pretty", indent: 2 })).toBe(2);
  });
  it("indentArg pretty + 4 → 4", () => {
    expect(indentArg({ mode: "pretty", indent: 4 })).toBe(4);
  });
  it("indentArg pretty + tab → tab character", () => {
    expect(indentArg({ mode: "pretty", indent: "tab" })).toBe("\t");
  });
});
