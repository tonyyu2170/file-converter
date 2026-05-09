// src/engines/archive-extract/index.test.ts
import { describe, expect, it } from "vitest";
import engine from "./index";

describe("archive-extract engine descriptor", () => {
  it("declares cardinality, category, archiveSuffix", () => {
    expect(engine.id).toBe("archive-extract");
    expect(engine.cardinality).toBe("single");
    expect(engine.category).toBe("archive");
    expect(engine.archiveSuffix).toBe("-extract");
  });

  it("validates by extension or MIME (lenient)", () => {
    expect(engine.validate(new File([], "foo.zip", { type: "application/zip" }), {}).ok).toBe(true);
    expect(engine.validate(new File([], "foo.zip", { type: "" }), {}).ok).toBe(true); // ext alone
    expect(engine.validate(new File([], "foo.bin", { type: "application/zip" }), {}).ok).toBe(true); // mime alone
    expect(engine.validate(new File([], "foo.tar.gz", { type: "" }), {}).ok).toBe(true);
    expect(engine.validate(new File([], "foo.tgz", { type: "" }), {}).ok).toBe(true);
    expect(engine.validate(new File([], "foo.txt", { type: "text/plain" }), {}).ok).toBe(false);
  });

  it("rejects files > 200 MB", () => {
    const big = new File([new Uint8Array(1)], "big.zip", { type: "application/zip" });
    Object.defineProperty(big, "size", { value: 250 * 1_000_000 });
    const result = engine.validate(big, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/limit 200 MB/);
  });
});
