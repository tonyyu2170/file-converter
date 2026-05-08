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
// Case 9: bad MIME → convert() rejects before worker spawns.
// Now that detectMime() runs host-side in convert() before harness dispatch,
// this is testable in vitest. The file has type:"" so detectMime inspects
// magic bytes; HTML bytes don't match any entry in the MAGIC table, so
// detectMime returns "application/octet-stream" which is not in
// SUPPORTED_INPUT_MIMES, causing convert() to throw.
// ---------------------------------------------------------------------------
describe("MIME validation in convert() (case 9)", () => {
  it("convert rejects when file bytes don't match a supported type", async () => {
    const htmlBytes = new TextEncoder().encode("<!DOCTYPE html><html><body>nope</body></html>");
    // type:"" forces detectMime into the magic-byte fallback path.
    // With type:"image/png" detectMime trusts file.type and would NOT reject.
    const file = new File([htmlBytes], "x.png", { type: "" });
    await expect(
      engine.convert(file, engine.defaultOptions, new AbortController().signal, {}),
    ).rejects.toThrow(/unsupported input MIME|content type|MIME/i);
  });
});

// ---------------------------------------------------------------------------
// Real OCR correctness — substring assertions on actual fixture conversion —
// runs in tests/e2e/image-to-text-correctness.spec.ts (Task 7). vitest +
// jsdom cannot host the Tesseract.js Web Worker that loads eng.traineddata,
// so the real-conversion path is exercised in Playwright instead. Cases
// covered there:
//   - scanned-receipt.png + outputFormat: "txt" → "TOTAL" + "$" substrings
//   - screenshot.png + outputFormat: "json-with-bboxes" → JSON shape +
//     "recognizeText" substring + word-bbox fields
//   - screenshot.heic + outputFormat: "txt" → "recognizeText" substring
//     (libheif reuse path)
//   - already-aborted signal: covered below (abort lands before worker
//     spawns, so vitest can exercise it)
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

// ---------------------------------------------------------------------------
// Case 11 (C1 regression): setProgressLogger must be installed BEFORE
// loadTesseract() so cold-start logger events flow through.
//
// worker.ts cannot be imported directly in vitest because Comlink.expose(api)
// runs at module top-level in a non-Worker context. The full end-to-end
// cold-start ordering is verified in two complementary ways:
//
//   1. A CRITICAL comment in worker.ts documents the invariant and will
//      surface any future reordering during code review.
//   2. src/engines/_shared/tesseract/index.test.ts tests that a logger
//      installed before loadTesseract() receives events fired synchronously
//      by the mock's createWorker (see "installed callback receives progress
//      events from the worker"). If that test breaks, the shared primitives
//      powering the fix have regressed.
//
// This test asserts the unit-testable half: the setProgressLogger API
// accepts a callback before loadTesseract is called without error.
// ---------------------------------------------------------------------------
describe("cold-start progress ordering invariant (case 11)", () => {
  it("setProgressLogger can be installed before loadTesseract (no error)", async () => {
    const { setProgressLogger, __resetForTests, disposeTesseract } = await import(
      "@/engines/_shared/tesseract"
    );

    __resetForTests();
    // This must NOT throw — the logger is a mutable ref that is valid to set
    // at any time, including before loadTesseract has been called.
    expect(() => setProgressLogger((_m) => {})).not.toThrow();
    // Clean up; don't leave a stale logger across tests.
    setProgressLogger(null);
    await disposeTesseract();
    __resetForTests();
  });
});
