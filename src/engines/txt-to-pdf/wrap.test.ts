import { describe, expect, it } from "vitest";
import { wrapLine } from "./wrap";

describe("wrapLine", () => {
  it("returns a single element for a short line", () => {
    expect(wrapLine("hello", 80)).toEqual(["hello"]);
  });

  it("returns [''] for an empty line (preserves blank lines)", () => {
    expect(wrapLine("", 80)).toEqual([""]);
  });

  it("hard-wraps at exactly maxColumns characters", () => {
    const line = "a".repeat(85);
    const result = wrapLine(line, 80);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(80);
    expect(result[1]).toHaveLength(5);
  });

  it("wraps a line exactly at the boundary into one piece", () => {
    const line = "x".repeat(80);
    expect(wrapLine(line, 80)).toEqual([line]);
  });

  it("wraps ligature-containing text without errors (// => != || &&)", () => {
    const line = "if (a // b) => c != d || e && f";
    // Should not throw; result is a non-empty array
    const result = wrapLine(line, 80);
    expect(result.length).toBeGreaterThan(0);
    expect(result.join("")).toBe(line);
  });

  it("handles a very long line spanning multiple wraps", () => {
    const line = "x".repeat(250);
    const result = wrapLine(line, 80);
    // 250 / 80 = 3 full + 10 remainder
    expect(result).toHaveLength(4);
    expect(result[0]).toHaveLength(80);
    expect(result[3]).toHaveLength(10);
  });

  it("joins wrapped pieces back to the original string", () => {
    const line = "a very long line that goes on and on and on";
    const result = wrapLine(line, 10);
    expect(result.join("")).toBe(line);
  });
});
