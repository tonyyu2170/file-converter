import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { convertXmlToJson } from "./worker";

const FIX = path.resolve(__dirname, "../../../tests/fixtures/data");
function readFix(name: string): ArrayBuffer {
  const buf = readFileSync(path.join(FIX, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe("xml-to-json: happy paths", () => {
  it("parses sample.xml with default @ prefix", async () => {
    const out = await convertXmlToJson(readFix("sample.xml"), "sample.xml", {
      attributePrefix: "@",
    });
    expect(out.filename).toBe("sample.json");
    const parsed = JSON.parse(await out.blob.text()) as Record<string, unknown>;
    const lib = parsed.library as Record<string, unknown>;
    const books = lib.book as Array<Record<string, unknown>>;
    expect(books).toHaveLength(2);
    expect(books[0]?.["@id"]).toBe("1");
    expect(books[0]?.title).toBe("Pride and Prejudice");
  });

  it("uses $_ prefix when configured", async () => {
    const out = await convertXmlToJson(readFix("sample.xml"), "sample.xml", {
      attributePrefix: "$_",
    });
    const parsed = JSON.parse(await out.blob.text()) as Record<string, unknown>;
    const lib = parsed.library as Record<string, unknown>;
    const books = lib.book as Array<Record<string, unknown>>;
    expect(books[0]?.$_id).toBe("1");
  });

  it("preserves namespace prefixes verbatim", async () => {
    const out = await convertXmlToJson(readFix("namespaced.xml"), "namespaced.xml", {
      attributePrefix: "@",
    });
    const text = await out.blob.text();
    expect(text).toContain("svg:rect");
    expect(text).toContain("xlink:href");
  });

  it("handles mixed content best-effort (no throw)", async () => {
    const out = await convertXmlToJson(readFix("mixed.xml"), "mixed.xml", { attributePrefix: "@" });
    const text = await out.blob.text();
    expect(text).toContain("Hello");
  });
});

describe("xml-to-json: rejections", () => {
  it("rejects malformed XML with native parser message", async () => {
    const garbage = new TextEncoder().encode("<root><unclosed>").buffer as ArrayBuffer;
    await expect(convertXmlToJson(garbage, "x.xml", { attributePrefix: "@" })).rejects.toThrow(
      /not valid XML/,
    );
  });
});
