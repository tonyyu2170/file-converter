import { describe, expect, it } from "vitest";
import {
  defaultArchiveBasename,
  defaultArchiveCreateOptions,
  extensionFor,
  validateFilename,
} from "./options";

describe("ArchiveCreateOptions", () => {
  it("default basename matches archive-YYYYMMDD-HHmm shape", () => {
    expect(defaultArchiveBasename(new Date(2026, 4, 8, 19, 34))).toBe("archive-20260508-1934");
  });
  it("default options preset zip + a basename", () => {
    expect(defaultArchiveCreateOptions.outputFormat).toBe("zip");
    expect(defaultArchiveCreateOptions.filename).toMatch(/^archive-\d{8}-\d{4}$/);
  });
  it("extensionFor maps formats", () => {
    expect(extensionFor("zip")).toBe("zip");
    expect(extensionFor("tar.gz")).toBe("tar.gz");
  });
  it("validateFilename accepts valid names", () => {
    expect(validateFilename("foo")).toEqual({ ok: true });
    expect(validateFilename("foo.bar-baz_1")).toEqual({ ok: true });
  });
  it("validateFilename rejects invalid", () => {
    expect(validateFilename("").ok).toBe(false);
    expect(validateFilename("foo bar").ok).toBe(false); // space
    expect(validateFilename("foo/bar").ok).toBe(false); // slash
    expect(validateFilename("a".repeat(101)).ok).toBe(false); // too long
  });
});
