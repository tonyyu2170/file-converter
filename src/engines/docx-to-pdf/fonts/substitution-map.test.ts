import { describe, expect, it } from "vitest";
import { DEFAULT_SUB, isKnownFont, pickFont } from "./substitution-map";

describe("pickFont", () => {
  it.each([
    ["Calibri", "inter"],
    ["Calibri Light", "inter"],
    ["Arial", "inter"],
    ["Helvetica", "inter"],
    ["Helvetica Neue", "inter"],
    ["Verdana", "inter"],
    ["Tahoma", "inter"],
    ["Open Sans", "inter"],
    ["Roboto", "inter"],
    ["Segoe UI", "inter"],
  ])("maps sans-serif %s to inter", (name, expected) => {
    expect(pickFont(name)).toBe(expected);
  });

  it.each([
    ["Cambria", "lora"],
    ["Cambria Math", "lora"],
    ["Times New Roman", "lora"],
    ["Times", "lora"],
    ["Georgia", "lora"],
    ["Garamond", "lora"],
    ["Palatino", "lora"],
    ["Palatino Linotype", "lora"],
  ])("maps serif %s to lora", (name, expected) => {
    expect(pickFont(name)).toBe(expected);
  });

  it.each([
    ["Courier New", "jetbrains-mono"],
    ["Courier", "jetbrains-mono"],
    ["Consolas", "jetbrains-mono"],
    ["Monaco", "jetbrains-mono"],
    ["Menlo", "jetbrains-mono"],
  ])("maps monospace %s to jetbrains-mono", (name, expected) => {
    expect(pickFont(name)).toBe(expected);
  });

  it("is case-insensitive", () => {
    expect(pickFont("CALIBRI")).toBe("inter");
    expect(pickFont("calibri")).toBe("inter");
    expect(pickFont("CaLiBrI")).toBe("inter");
  });

  it("trims whitespace", () => {
    expect(pickFont("  Calibri  ")).toBe("inter");
    expect(pickFont("\tTimes New Roman\n")).toBe("lora");
  });

  it("falls back to DEFAULT_SUB for unknown names", () => {
    expect(pickFont("Comic Sans MS")).toBe(DEFAULT_SUB);
    expect(pickFont("Wingdings")).toBe(DEFAULT_SUB);
    expect(pickFont("Some Font That Doesn't Exist")).toBe(DEFAULT_SUB);
    expect(DEFAULT_SUB).toBe("inter");
  });

  it("falls back to DEFAULT_SUB for undefined", () => {
    expect(pickFont(undefined)).toBe(DEFAULT_SUB);
  });

  it("falls back to DEFAULT_SUB for empty string", () => {
    expect(pickFont("")).toBe(DEFAULT_SUB);
    expect(pickFont("   ")).toBe(DEFAULT_SUB);
  });
});

describe("isKnownFont", () => {
  it("returns true for explicit substitution entries", () => {
    expect(isKnownFont("Calibri")).toBe(true);
    expect(isKnownFont("Times New Roman")).toBe(true);
    expect(isKnownFont("Courier New")).toBe(true);
  });

  it("returns false for unknown names (which fall back to default)", () => {
    expect(isKnownFont("Comic Sans MS")).toBe(false);
  });

  it("returns false for undefined / empty", () => {
    expect(isKnownFont(undefined)).toBe(false);
    expect(isKnownFont("")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isKnownFont("CALIBRI")).toBe(true);
    expect(isKnownFont("calibri")).toBe(true);
  });
});
