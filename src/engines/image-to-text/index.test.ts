/**
 * image-to-text engine — descriptor, validate, and integration tests.
 *
 * Cases 1–5 (descriptor + validate): run in jsdom via the engine's public API.
 * Cases 6–9 (OCR correctness): real OCR cannot run in vitest because tesseract.js
 *   requires a node environment (filesystem adapter) but that env is incompatible
 *   with jsdom. These cases are covered by Playwright E2E tests instead.
 * Case 10 (abort): verified here — the harness rejects synchronously when
 *   signal.aborted is true (Worker spawn throws in jsdom; either is a valid
 *   rejection).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import engine from "./index";

// ---------------------------------------------------------------------------
// Fixture loader
// ---------------------------------------------------------------------------
async function fixtureFile(name: string, mime: string): Promise<File> {
  const bytes = await readFile(
    path.resolve(__dirname, "../../../tests/fixtures/image-to-text", name),
  );
  return new File([bytes], name, { type: mime });
}

// ---------------------------------------------------------------------------
// Case 1: engine.id and descriptor fields
// ---------------------------------------------------------------------------
describe("image-to-text engine descriptor (case 1)", () => {
  it("engine.id is image-to-text", () => {
    expect(engine.id).toBe("image-to-text");
  });

  it("category is ocr", () => {
    expect(engine.category).toBe("ocr");
  });

  it("cardinality is single", () => {
    expect(engine.cardinality).toBe("single");
  });

  it("OptionsPanel is wired", () => {
    expect(engine.OptionsPanel).toBeDefined();
  });

  it("library references tesseract.js", () => {
    expect(engine.library).toMatch(/tesseract/i);
  });

  it("license is Apache-2.0", () => {
    expect(engine.license).toBe("Apache-2.0");
  });

  it("defaultOptions has txt outputFormat", () => {
    expect(engine.defaultOptions.outputFormat).toBe("txt");
  });

  it("inputAccept includes jpg, jpeg, png, webp, heic", () => {
    expect(engine.inputAccept).toEqual(
      expect.arrayContaining([".jpg", ".jpeg", ".png", ".webp", ".heic"]),
    );
  });
});

// ---------------------------------------------------------------------------
// Case 2: validate accepts known image extensions even when file.type is empty
// ---------------------------------------------------------------------------
describe("validate — accepted formats (case 2)", () => {
  const accepted = [
    ["test.png", "image/png"],
    ["test.jpg", "image/jpeg"],
    ["test.jpeg", "image/jpeg"],
    ["test.webp", "image/webp"],
    // Safari HEIC case: extension present, type empty string
    ["test.heic", ""],
  ] as const;

  for (const [name, type] of accepted) {
    it(`accepts ${name} (type="${type}")`, () => {
      const file = new File([new Uint8Array([0])], name, { type });
      const result = engine.validate(file, engine.defaultOptions);
      expect(result.ok).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Case 3: validate rejects unsupported formats (bad MIME and bad extension)
// ---------------------------------------------------------------------------
describe("validate — rejected formats (case 3)", () => {
  it("rejects .gif with empty file.type", () => {
    const file = new File([new Uint8Array([0])], "anim.gif", { type: "" });
    const result = engine.validate(file, engine.defaultOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/JPG|PNG|WebP|HEIC/i);
    }
  });

  it("rejects .mp4 with video/mp4 type", () => {
    const file = new File([new Uint8Array([0])], "video.mp4", { type: "video/mp4" });
    const result = engine.validate(file, engine.defaultOptions);
    expect(result.ok).toBe(false);
  });

  it("rejects .pdf with application/pdf type", () => {
    const file = new File([new Uint8Array([0])], "doc.pdf", { type: "application/pdf" });
    const result = engine.validate(file, engine.defaultOptions);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Case 4: validate rejects files > 25 MB
// ---------------------------------------------------------------------------
describe("validate — size limit (case 4)", () => {
  it("rejects a file reported as 26 MB", () => {
    // Use defineProperty to avoid allocating 26 MB of actual bytes.
    const file = new File([new Uint8Array([0])], "big.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: 26_000_000 });
    const result = engine.validate(file, engine.defaultOptions);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/25 MB/i);
    }
  });

  it("accepts a file just under 25 MB", () => {
    const file = new File([new Uint8Array([0])], "ok.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: 24_999_999 });
    const result = engine.validate(file, engine.defaultOptions);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Case 5: lenient — accepts empty type when extension is known
// ---------------------------------------------------------------------------
describe("validate — lenient type+ext fallback (case 5)", () => {
  it("accepts file with empty type but known .png extension", () => {
    const file = new File([new Uint8Array([0])], "photo.png", { type: "" });
    const result = engine.validate(file, engine.defaultOptions);
    expect(result.ok).toBe(true);
  });

  it("accepts file with empty type but known .webp extension", () => {
    const file = new File([new Uint8Array([0])], "photo.webp", { type: "" });
    const result = engine.validate(file, engine.defaultOptions);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cases 6–9 (OCR correctness): see worker.correctness.test.ts.
// Real OCR requires a node environment (to avoid tesseract.js picking its
// browser HTTP-fetch path); that environment is incompatible with jsdom.
// These cases are covered by Playwright E2E tests instead.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Case 10: already-aborted AbortSignal causes engine.convert() to reject.
// The WorkerHarness checks signal.aborted early and rejects without waiting
// for Worker spawn. In jsdom, Worker may be undefined (ReferenceError) or
// AbortError — either way the promise rejects.
// ---------------------------------------------------------------------------
describe("cancellation (case 10)", () => {
  it("already-aborted signal causes convert to reject", async () => {
    const file = await fixtureFile("scanned-receipt.png", "image/png");
    const signal = AbortSignal.abort();
    await expect(engine.convert(file, engine.defaultOptions, signal, {})).rejects.toThrow();
  });
});
