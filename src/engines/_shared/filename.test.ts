import { describe, expect, it } from "vitest";
import { pageSuffixedName, replaceExtension, sanitizeFilename } from "./filename";

describe("replaceExtension", () => {
  it("swaps a normal extension", () => {
    expect(replaceExtension("vacation.heic", "png")).toBe("vacation.png");
  });

  it("accepts extension with leading dot", () => {
    expect(replaceExtension("vacation.heic", ".png")).toBe("vacation.png");
  });

  it("appends when no extension present", () => {
    expect(replaceExtension("README", "txt")).toBe("README.txt");
  });

  it("does not treat leading-dot files as extensions", () => {
    expect(replaceExtension(".gitignore", "txt")).toBe(".gitignore.txt");
  });

  it("handles multiple dots — only the last is the extension", () => {
    expect(replaceExtension("archive.tar.gz", "zip")).toBe("archive.tar.zip");
  });
});

describe("pageSuffixedName", () => {
  it("produces page-N suffix", () => {
    expect(pageSuffixedName("doc.pdf", 1, "png")).toBe("doc-page-1.png");
    expect(pageSuffixedName("doc.pdf", 42, "png")).toBe("doc-page-42.png");
  });
});

describe("sanitizeFilename", () => {
  it("preserves dot, digits, hyphens, underscores in normal names", () => {
    expect(sanitizeFilename("vacation.png")).toBe("vacation.png");
    expect(sanitizeFilename("doc-page-1.png")).toBe("doc-page-1.png");
    expect(sanitizeFilename("IMG_1234.heic")).toBe("IMG_1234.heic");
  });

  it("replaces forbidden cross-platform chars", () => {
    expect(sanitizeFilename('a/b\\c<d>e:f"g|h?i*j.txt')).toBe("a_b_c_d_e_f_g_h_i_j.txt");
  });

  it("replaces spaces", () => {
    expect(sanitizeFilename("my file.txt")).toBe("my_file.txt");
  });

  it("truncates to 255 chars", () => {
    const long = `${"a".repeat(300)}.txt`;
    expect(sanitizeFilename(long)).toHaveLength(255);
  });
});
