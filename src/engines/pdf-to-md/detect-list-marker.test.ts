import { describe, expect, it } from "vitest";
import { detectListMarker } from "./detect-list-marker";

describe("detectListMarker — unordered glyphs", () => {
  it.each([
    ["• item", "item"],
    ["* item", "item"],
    ["- item", "item"],
    ["– item", "item"],
    ["— item", "item"],
  ] as [string, string][])("%j → unordered with rest %j", (input, rest) => {
    expect(detectListMarker(input)).toEqual({ kind: "unordered", rest });
  });

  it("strips leading whitespace before matching", () => {
    expect(detectListMarker("   • foo")).toEqual({ kind: "unordered", rest: "foo" });
  });

  it("collapses leading whitespace after marker but preserves internal whitespace", () => {
    // \s+ after marker is greedy, so all leading whitespace is consumed.
    expect(detectListMarker("•  foo  bar")).toEqual({ kind: "unordered", rest: "foo  bar" });
  });
});

describe("detectListMarker — ordered", () => {
  it.each([
    ["1. foo", 1, "foo"],
    ["2) bar", 2, "bar"],
    ["12. baz", 12, "baz"],
    ["007. seven", 7, "seven"],
  ] as [string, number, string][])("%j → ordered ordinal=%i rest=%j", (input, ordinal, rest) => {
    expect(detectListMarker(input)).toEqual({ kind: "ordered", ordinal, rest });
  });
});

describe("detectListMarker — graceful degrade markers", () => {
  it("maps lowercase letter + paren to unordered", () => {
    expect(detectListMarker("a) foo")).toEqual({ kind: "unordered", rest: "foo" });
  });

  it("maps lowercase roman + period to unordered", () => {
    expect(detectListMarker("ii. foo")).toEqual({ kind: "unordered", rest: "foo" });
    expect(detectListMarker("iv. four")).toEqual({ kind: "unordered", rest: "four" });
  });

  it("matches roman numerals case-insensitively", () => {
    expect(detectListMarker("IV. four")).toEqual({ kind: "unordered", rest: "four" });
  });
});

describe("detectListMarker — none cases (no false positives)", () => {
  it("returns none on empty input", () => {
    expect(detectListMarker("")).toEqual({ kind: "none" });
  });

  it("returns none on whitespace-only input", () => {
    expect(detectListMarker("   ")).toEqual({ kind: "none" });
  });

  it.each(["1.5", "*important", "-foo", "(a)bar", "•foo"])(
    "returns none when marker has no trailing whitespace: %j",
    (input) => {
      expect(detectListMarker(input)).toEqual({ kind: "none" });
    },
  );

  it("returns none for plain body text", () => {
    expect(detectListMarker("Hello world")).toEqual({ kind: "none" });
  });

  it("returns none for capital letter parens (not in graceful degrade set)", () => {
    expect(detectListMarker("A) foo")).toEqual({ kind: "none" });
  });

  it("documents the trailing-space decimal false positive (by design)", () => {
    // The \s+ gate is the only protection against decimals; "1. 5" with
    // a space after the dot will be parsed as an ordered list. This is
    // accepted as a heuristic limitation per spec.
    expect(detectListMarker("1. 5")).toEqual({ kind: "ordered", ordinal: 1, rest: "5" });
  });
});
