import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { convertData } from "./worker";

const FIX = path.resolve(__dirname, "../../../tests/fixtures/data");
function readFix(name: string): ArrayBuffer {
  const buf = readFileSync(path.join(FIX, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe("data-convert: happy paths (cross-format round-trips)", () => {
  it("csv → json", async () => {
    const out = await convertData(readFix("sample.csv"), "sample.csv", "text/csv", {
      outputFormat: "json",
    });
    expect(out.filename).toBe("sample.json");
    const parsed = JSON.parse(await out.blob.text()) as Array<Record<string, unknown>>;
    expect(parsed).toHaveLength(4);
    expect(parsed[0]).toEqual({ id: "1", name: "Alice", score: "95" });
  });

  it("csv → yaml", async () => {
    const out = await convertData(readFix("sample.csv"), "sample.csv", "text/csv", {
      outputFormat: "yaml",
    });
    expect(out.filename).toBe("sample.yaml");
    const text = await out.blob.text();
    expect(text).toContain("Alice");
    expect(text).toContain("score:");
  });

  it("json → csv", async () => {
    const out = await convertData(readFix("sample.json"), "sample.json", "application/json", {
      outputFormat: "csv",
    });
    expect(out.filename).toBe("sample.csv");
    const text = await out.blob.text();
    expect(text.split("\n")[0]).toBe("id,name,score");
    expect(text).toContain("Alice");
  });

  it("json → yaml", async () => {
    const out = await convertData(readFix("sample.json"), "sample.json", "application/json", {
      outputFormat: "yaml",
    });
    expect(await out.blob.text()).toContain("name: Alice");
  });

  it("yaml → csv", async () => {
    const out = await convertData(readFix("sample.yaml"), "sample.yaml", "application/yaml", {
      outputFormat: "csv",
    });
    const text = await out.blob.text();
    expect(text.split("\n")[0]).toBe("id,name,score");
  });

  it("yaml → json", async () => {
    const out = await convertData(readFix("sample.yaml"), "sample.yaml", "application/yaml", {
      outputFormat: "json",
    });
    const parsed = JSON.parse(await out.blob.text()) as Array<Record<string, unknown>>;
    expect(parsed[0]?.name).toBe("Alice");
  });
});

describe("data-convert: rejections", () => {
  it("rejects same-format conversion (csv → csv)", async () => {
    await expect(
      convertData(readFix("sample.csv"), "sample.csv", "text/csv", { outputFormat: "csv" }),
    ).rejects.toThrow(/already csv/);
  });

  it("rejects XML input pointing user at xml-to-json", async () => {
    const xml = new TextEncoder().encode("<root/>").buffer as ArrayBuffer;
    await expect(
      convertData(xml, "x.xml", "application/xml", { outputFormat: "json" }),
    ).rejects.toThrow(/xml-to-json/);
  });

  it("rejects unrecognized format", async () => {
    const blob = new TextEncoder().encode("hello world").buffer as ArrayBuffer;
    await expect(convertData(blob, "x.bin", "", { outputFormat: "json" })).rejects.toThrow(
      /unrecognized format/,
    );
  });

  it("rejects JSON → CSV when top-level is not an array", async () => {
    await expect(
      convertData(readFix("non-array.json"), "non-array.json", "application/json", {
        outputFormat: "csv",
      }),
    ).rejects.toThrow(/not a top-level array/);
  });

  it("rejects JSON → CSV when a row contains a nested object", async () => {
    await expect(
      convertData(readFix("nested.json"), "nested.json", "application/json", {
        outputFormat: "csv",
      }),
    ).rejects.toThrow(/nested object/);
  });

  it("rejects JSON → CSV when rows have non-uniform shape", async () => {
    await expect(
      convertData(readFix("missing-key.json"), "missing-key.json", "application/json", {
        outputFormat: "csv",
      }),
    ).rejects.toThrow(/missing key/);
  });

  it("rejects YAML using a non-SAFE_SCHEMA tag (!!js/function)", async () => {
    await expect(
      convertData(readFix("unsafe.yaml"), "unsafe.yaml", "application/yaml", {
        outputFormat: "json",
      }),
    ).rejects.toThrow(/SAFE_SCHEMA/);
  });
});
