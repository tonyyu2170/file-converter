import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatJson } from "./worker";

const FIX = path.resolve(__dirname, "../../../tests/fixtures/data");
function readFix(name: string): ArrayBuffer {
  const buf = readFileSync(path.join(FIX, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe("json-format: pretty / minify / indent", () => {
  it("default pretty (indent 2) on sample.json", async () => {
    const out = await formatJson(readFix("sample.json"), "sample.json", {
      mode: "pretty",
      indent: 2,
    });
    const text = await out.blob.text();
    expect(text).toContain('  "id": 1,');
    expect(out.filename).toBe("sample.json");
  });

  it("minify produces single-line output", async () => {
    const out = await formatJson(readFix("sample.json"), "sample.json", {
      mode: "minify",
      indent: 2,
    });
    const text = await out.blob.text();
    expect(text).not.toMatch(/\n/);
    expect(text).toContain('"id":1');
  });

  it("pretty with 4-space indent", async () => {
    const out = await formatJson(readFix("sample.json"), "sample.json", {
      mode: "pretty",
      indent: 4,
    });
    const text = await out.blob.text();
    expect(text).toContain('    "id": 1,');
  });

  it("pretty with tab indent", async () => {
    const out = await formatJson(readFix("sample.json"), "sample.json", {
      mode: "pretty",
      indent: "tab",
    });
    const text = await out.blob.text();
    expect(text).toContain('\t"id": 1,');
  });
});

describe("json-format: edge cases", () => {
  it("strips leading UTF-8 BOM before parsing", async () => {
    const out = await formatJson(readFix("bom.json"), "bom.json", { mode: "pretty", indent: 2 });
    const text = await out.blob.text();
    expect(text).toContain('"key": "value"');
  });

  it("rejects empty file", async () => {
    const empty = new ArrayBuffer(0);
    await expect(formatJson(empty, "empty.json", { mode: "pretty", indent: 2 })).rejects.toThrow(
      /empty/,
    );
  });

  it("rejects invalid JSON with native message", async () => {
    const garbage = new TextEncoder().encode("{not valid").buffer as ArrayBuffer;
    await expect(formatJson(garbage, "x.json", { mode: "pretty", indent: 2 })).rejects.toThrow(
      /not valid JSON/,
    );
  });
});
