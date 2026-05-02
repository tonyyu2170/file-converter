import { describe, expect, it } from "vitest";
import { parseRange, parseRangeTokens } from "./range";

describe("parseRange — accepts", () => {
  it.each([
    // [input, pageCount, expectedIndices]
    ["", 5, [0, 1, 2, 3, 4]],
    ["   ", 5, [0, 1, 2, 3, 4]],
    ["1", 5, [0]],
    ["5", 5, [4]],
    ["1-3", 5, [0, 1, 2]],
    ["1-5", 5, [0, 1, 2, 3, 4]],
    ["3-", 5, [2, 3, 4]],
    ["-3", 5, [0, 1, 2]],
    ["1, 3, 5", 5, [0, 2, 4]],
    ["1-2, 4-5", 5, [0, 1, 3, 4]],
    ["1-3, 5, 7-", 10, [0, 1, 2, 4, 6, 7, 8, 9]],
    [" 1 - 3 , 5 ", 5, [0, 1, 2, 4]],
    ["2-2", 5, [1]],
    // duplicates and overlaps allowed (§3.2)
    ["1, 1", 5, [0, 0]],
    ["1-3, 2", 5, [0, 1, 2, 1]],
    // open-ended with internal whitespace
    ["3 -", 5, [2, 3, 4]],
    [" - 3", 5, [0, 1, 2]],
  ] as [string, number, number[]][])("%j over %i pages → %j", (input, pageCount, expected) => {
    const r = parseRange(input, pageCount);
    expect(r).toEqual({ ok: true, indices: expected });
  });
});

describe("parseRange — rejects", () => {
  it.each([
    ["abc", 5, /can't parse/],
    ["1-foo", 5, /can't parse/],
    ["foo-3", 5, /can't parse/],
    ["0", 5, /must be 1 or greater/],
    ["1-0", 5, /must be 1 or greater/],
    ["-0", 5, /must be 1 or greater/],
    ["0-3", 5, /must be 1 or greater/],
    ["3-1", 5, /reversed/],
    ["5-2", 5, /reversed/],
    ["7", 5, /exceeds 5/],
    ["1-7", 5, /exceeds 5/],
    ["7-", 5, /exceeds 5/],
    ["-7", 5, /exceeds 5/],
    ["1,,3", 5, /empty token/],
    ["1,3,", 5, /trailing comma/],
    [",1,3", 5, /leading comma/],
    ["-", 5, /bare dash/],
    ["1-2-3", 5, /can't parse/],
    // whitespace-only middle token
    ["1, ,3", 5, /empty token/],
    // valid first, reversed second (verifies error propagation)
    ["1-2, 3-1", 5, /reversed/],
    // multi-zero
    ["00", 5, /must be 1 or greater/],
    ["00-3", 5, /must be 1 or greater/],
  ])("%j over %i pages → reject matching %s", (input, pageCount, pattern) => {
    const r = parseRange(input, pageCount);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(pattern);
  });
});

describe("parseRange — pageCount = 0", () => {
  it("returns empty indices for empty input", () => {
    expect(parseRange("", 0)).toEqual({ ok: true, indices: [] });
  });
  it("rejects any positive page reference", () => {
    expect(parseRange("1", 0)).toEqual({ ok: false, reason: expect.stringMatching(/exceeds 0/) });
  });
});

describe("parseRangeTokens — accepts", () => {
  it("returns no tokens for empty input", () => {
    const r = parseRangeTokens("", 5);
    expect(r).toEqual({ ok: true, tokens: [] });
  });

  it("returns no tokens for whitespace-only input", () => {
    const r = parseRangeTokens("   ", 5);
    expect(r).toEqual({ ok: true, tokens: [] });
  });

  it("returns one token for single-page input", () => {
    const r = parseRangeTokens("3", 5);
    expect(r).toEqual({ ok: true, tokens: [{ original: "3", indices: [2] }] });
  });

  it("returns one token for closed-range input", () => {
    const r = parseRangeTokens("1-3", 5);
    expect(r).toEqual({ ok: true, tokens: [{ original: "1-3", indices: [0, 1, 2] }] });
  });

  it("returns one token for open-ended start", () => {
    const r = parseRangeTokens("3-", 5);
    expect(r).toEqual({ ok: true, tokens: [{ original: "3-", indices: [2, 3, 4] }] });
  });

  it("returns one token for open-ended end", () => {
    const r = parseRangeTokens("-3", 5);
    expect(r).toEqual({ ok: true, tokens: [{ original: "-3", indices: [0, 1, 2] }] });
  });

  it("returns multiple tokens, each preserving original text", () => {
    const r = parseRangeTokens("1-3, 5, 7-", 10);
    expect(r).toEqual({
      ok: true,
      tokens: [
        { original: "1-3", indices: [0, 1, 2] },
        { original: "5", indices: [4] },
        { original: "7-", indices: [6, 7, 8, 9] },
      ],
    });
  });

  it("trims whitespace in original token text", () => {
    const r = parseRangeTokens(" 1 - 3 , 5 ", 5);
    // original is the trimmed token, not the raw input slice
    expect(r).toEqual({
      ok: true,
      tokens: [
        { original: "1 - 3", indices: [0, 1, 2] },
        { original: "5", indices: [4] },
      ],
    });
  });
});

describe("parseRangeTokens — rejects", () => {
  it("rejects on first malformed token (short-circuit)", () => {
    const r = parseRangeTokens("1, abc, 3", 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/can't parse 'abc'/);
  });

  it("rejects on first reversed token", () => {
    const r = parseRangeTokens("1-2, 5-3, 4", 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/reversed/);
  });

  it("rejects on first OOB token", () => {
    const r = parseRangeTokens("1-2, 7", 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/exceeds 5/);
  });
});

describe("parseRange / parseRangeTokens asymmetry", () => {
  it("parseRange returns all-pages on empty input (legacy pdf-merge behavior)", () => {
    expect(parseRange("", 5)).toEqual({ ok: true, indices: [0, 1, 2, 3, 4] });
  });

  it("parseRangeTokens returns no tokens on empty input (engine-gate behavior)", () => {
    expect(parseRangeTokens("", 5)).toEqual({ ok: true, tokens: [] });
  });
});
