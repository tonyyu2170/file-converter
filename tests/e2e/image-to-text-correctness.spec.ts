import { promises as fs } from "node:fs";
import { expect, test } from "@playwright/test";

// =====================================================================
// Real-OCR correctness for the image-to-text engine.
// Gated by RUN_IMAGE_TO_TEXT_CORRECTNESS=1 to keep the default CI
// pass fast (Tesseract cold-start + wasm takes 5–15 s per browser).
//
// Usage:
//   RUN_IMAGE_TO_TEXT_CORRECTNESS=1 pnpm test:e2e --project=chromium \
//     tests/e2e/image-to-text-correctness.spec.ts
//
// With 8 GB RAM, limit Playwright workers to avoid OOM:
//   RUN_IMAGE_TO_TEXT_CORRECTNESS=1 pnpm test:e2e --workers=1 \
//     tests/e2e/image-to-text-correctness.spec.ts
// =====================================================================

const SHOULD_RUN = process.env.RUN_IMAGE_TO_TEXT_CORRECTNESS === "1";

test.skip(!SHOULD_RUN, "set RUN_IMAGE_TO_TEXT_CORRECTNESS=1 to run");

// Run serially so each test pays cold-start independently (intentional:
// each test exercises the persistent harness being warm or cold as a
// real first-visit user would). Keep a tight timeline under 240 s.
test.describe.configure({ mode: "serial", timeout: 240_000 });

// ---------------------------------------------------------------------------
// Case 1: scanned-receipt.png → txt — output contains "TOTAL"
// ---------------------------------------------------------------------------
test("scanned-receipt.png → txt contains TOTAL", async ({ page }) => {
  await page.goto("/tools/image-to-text");
  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  // Default output format is txt — no need to change the select.
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles("tests/fixtures/image-to-text/scanned-receipt.png");

  await page.getByTestId("convert-button").click();

  // Tesseract cold-start (worker + wasm + traineddata) takes up to ~15 s.
  // 120 s matches the project-wide conversion timeout used by other specs.
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 120_000,
  });

  const downloadButton = page.getByRole("button", { name: /^download / });
  await expect(downloadButton).toBeVisible();

  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await downloadButton.click();
  const download = await downloadPromise;

  const outPath = await download.path();
  if (!outPath) throw new Error("download.path() returned null");

  const text = await fs.readFile(outPath, "utf-8");
  // The fixture was synthesized with "TOTAL" as a visible label —
  // assert case-insensitively so minor OCR casing variance doesn't flake.
  expect(text.toUpperCase()).toContain("TOTAL");
});

// ---------------------------------------------------------------------------
// Case 2: screenshot.png → json-with-bboxes — shape + text assertions
// ---------------------------------------------------------------------------
test("screenshot.png → json-with-bboxes has expected structure", async ({ page }) => {
  await page.goto("/tools/image-to-text");
  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  await page.getByTestId("output-format-select").selectOption("json-with-bboxes");
  await expect(page.getByTestId("output-format-select")).toHaveValue("json-with-bboxes");

  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles("tests/fixtures/image-to-text/screenshot.png");

  await page.getByTestId("convert-button").click();

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 120_000,
  });

  const downloadButton = page.getByRole("button", { name: /^download / });
  await expect(downloadButton).toBeVisible();

  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await downloadButton.click();
  const download = await downloadPromise;

  const outPath = await download.path();
  if (!outPath) throw new Error("download.path() returned null");

  const raw = await fs.readFile(outPath, "utf-8");
  // biome-ignore lint/suspicious/noExplicitAny: JSON output from engine
  const parsed: any = JSON.parse(raw);

  // text field contains the recognized content
  expect(typeof parsed.text).toBe("string");
  expect(parsed.text.toLowerCase()).toContain("recognizetext");

  // words is a non-empty array of bbox records
  expect(Array.isArray(parsed.words)).toBe(true);
  expect(parsed.words.length).toBeGreaterThan(0);

  // Spot-check the first word for the expected WordBbox shape
  const first = parsed.words[0];
  expect(typeof first.text).toBe("string");
  expect(typeof first.confidence).toBe("number");
  expect(typeof first.x).toBe("number");
  expect(typeof first.y).toBe("number");
  expect(typeof first.w).toBe("number");
  expect(typeof first.h).toBe("number");
});

// ---------------------------------------------------------------------------
// Case 3: screenshot.heic → txt — exercises libheif reuse path
// ---------------------------------------------------------------------------
test("screenshot.heic → txt contains recognizeText (libheif path)", async ({ page }) => {
  await page.goto("/tools/image-to-text");
  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  // Default format is txt — no change needed.
  // Playwright infers type from extension (.heic → image/heic), which routes
  // the worker to the libheif decode branch. This exercises the same decode
  // path as a regular HEIC upload. The Safari empty-type variant is
  // documented in worker.ts but is not a Playwright concern: the worker's
  // routing uses both MIME and extension, so both paths are covered.
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles("tests/fixtures/image-to-text/screenshot.heic");

  await page.getByTestId("convert-button").click();

  // HEIC decode + Tesseract cold-start may be slower — allow full budget.
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 120_000,
  });

  const downloadButton = page.getByRole("button", { name: /^download / });
  await expect(downloadButton).toBeVisible();

  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await downloadButton.click();
  const download = await downloadPromise;

  const outPath = await download.path();
  if (!outPath) throw new Error("download.path() returned null");

  const text = await fs.readFile(outPath, "utf-8");
  expect(text.toLowerCase()).toContain("recognizetext");
});

// ---------------------------------------------------------------------------
// Case 4: cancel mid-conversion
//
// Not implemented: tool-frame.tsx does not expose a cancel/abort button in
// the UI. The AbortController abort path is exercised at the unit-test level
// by src/engines/image-to-text/index.test.ts case 10. An E2E cancel test
// would require a UI cancel button added in a future task.
// ---------------------------------------------------------------------------
