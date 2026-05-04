import { describe, expect, it } from "vitest";
import { formatBytes } from "./format-bytes";

describe("formatBytes", () => {
  it("renders zero as '0 B'", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("renders sub-kilobyte values in bytes with no decimals", () => {
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(999)).toBe("999 B");
  });

  it("uses SI thresholds (1000) and switches to KB at 1000 B", () => {
    expect(formatBytes(1000)).toBe("1 KB");
    expect(formatBytes(1500)).toBe("1.5 KB");
  });

  it("shows 1 decimal for KB values under 10, integer otherwise", () => {
    expect(formatBytes(4_200)).toBe("4.2 KB");
    expect(formatBytes(9_949)).toBe("9.9 KB");
    expect(formatBytes(10_000)).toBe("10 KB");
    expect(formatBytes(512_000)).toBe("512 KB");
  });

  it("trims trailing .0 (e.g., 1024 B -> '1 KB' not '1.0 KB')", () => {
    expect(formatBytes(1024)).toBe("1 KB");
  });

  it("switches to MB at 1_000_000 B with the same precision rule", () => {
    expect(formatBytes(1_000_000)).toBe("1 MB");
    expect(formatBytes(4_200_000)).toBe("4.2 MB");
    expect(formatBytes(11_800_000)).toBe("12 MB");
    expect(formatBytes(512_000_000)).toBe("512 MB");
  });

  it("switches to GB at 1_000_000_000 B", () => {
    expect(formatBytes(1_000_000_000)).toBe("1 GB");
    expect(formatBytes(2_500_000_000)).toBe("2.5 GB");
    expect(formatBytes(42_000_000_000)).toBe("42 GB");
  });

  it("bumps unit when rounding would overflow (e.g., 999_500 -> '1 MB' not '1000 KB')", () => {
    expect(formatBytes(999_500)).toBe("1 MB");
    expect(formatBytes(999_500_000)).toBe("1 GB");
  });

  it("throws on negative or non-finite input", () => {
    expect(() => formatBytes(-1)).toThrow();
    expect(() => formatBytes(Number.NaN)).toThrow();
    expect(() => formatBytes(Number.POSITIVE_INFINITY)).toThrow();
  });
});
