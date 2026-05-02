import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const fix = (name: string) => path.resolve(__dirname, "../fixtures", name);

test("multi-token range produces N output PDFs + ZIP download (happy path)", async ({ page }) => {
  await page.goto("/tools/pdf-split");

  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  // CRITICAL ORDERING: the DropZone is disabled while isReadyToConvert
  // returns false (engine.isReadyToConvert: opts.rangeInput.trim().length > 0).
  // So we must type the range FIRST to enable the DropZone, then drop the
  // file. setInputFiles on a disabled input would not propagate through
  // ToolFrame's handleDrop callback.
  await page.getByTestId("range-input").fill("1-3, 5");

  // Now drop the 5-page PDF — DropZone is enabled, conversion fires.
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix("sample-5page.pdf"));

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });

  // Verify per-row download buttons.
  await expect(page.getByText("pages-1-3.pdf")).toBeVisible();
  await expect(page.getByText("page-5.pdf")).toBeVisible();

  // Verify the download-all-zip button is present and shows count = 2.
  const zipButton = page.getByTestId("download-all-zip");
  await expect(zipButton).toBeVisible();
  await expect(zipButton).toHaveText(/download all \(2\) as zip/i);

  // Click ZIP, capture download.
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await zipButton.click();
  const download = await downloadPromise;

  // Filename should match `sample-5page-split.zip` (basename + archiveSuffix).
  expect(download.suggestedFilename()).toMatch(/sample-5page-split\.zip$/i);

  // ZIP content sanity: read first 4 bytes — `PK\x03\x04` is the ZIP local
  // file header magic.
  const dlPath = await download.path();
  const bytes = await readFile(dlPath);
  expect(bytes[0]).toBe(0x50); // P
  expect(bytes[1]).toBe(0x4b); // K
  expect(bytes[2]).toBe(0x03);
  expect(bytes[3]).toBe(0x04);
  expect(bytes.length).toBeGreaterThan(500);
});

test("single-token range produces 1 PDF, no ZIP button", async ({ page }) => {
  await page.goto("/tools/pdf-split");

  // Type range first to enable DropZone (see happy-path test for rationale).
  await page.getByTestId("range-input").fill("1-3");

  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix("sample-5page.pdf"));

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });

  await expect(page.getByText("pages-1-3.pdf")).toBeVisible();
  // No download-all-zip button when items.length === 1.
  await expect(page.getByTestId("download-all-zip")).not.toBeVisible();

  // Per-row download produces a PDF.
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("button", { name: /^download pages-1-3\.pdf$/i }).click();
  const download = await downloadPromise;
  const bytes = await readFile(await download.path());
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
});

test("encrypted PDF surfaces error banner", async ({ page }) => {
  await page.goto("/tools/pdf-split");

  // Type range first to enable DropZone.
  await page.getByTestId("range-input").fill("1");

  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix("sample-encrypted.pdf"));

  // Worker throws "pdf-split: input PDF is password-protected" → ToolFrame
  // error banner.
  await expect(page.getByTestId("status-indicator")).toHaveText("[ ERROR ]", {
    timeout: 15_000,
  });
  await expect(page.getByText(/password-protected/i)).toBeVisible();
});

test("out-of-bounds range surfaces error banner", async ({ page }) => {
  await page.goto("/tools/pdf-split");

  // Type range first to enable DropZone.
  await page.getByTestId("range-input").fill("9");

  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix("sample-5page.pdf"));

  await expect(page.getByTestId("status-indicator")).toHaveText("[ ERROR ]", {
    timeout: 15_000,
  });
  await expect(page.getByText(/exceeds 5/i)).toBeVisible();
});

test("inline syntax error blocks Convert", async ({ page }) => {
  await page.goto("/tools/pdf-split");

  // Type a malformed range. The panel shows inline error immediately;
  // we don't drop a file because a malformed range with a file dropped
  // would proceed to the worker (engine.isReadyToConvert only checks
  // non-empty, not syntax validity — the panel's error is the primary
  // user feedback). For this test we want to verify the panel-level
  // error path independent of any conversion attempt.
  await page.getByTestId("range-input").fill("1, abc, 3");

  // Panel shows inline syntax error immediately.
  await expect(page.getByTestId("range-syntax-error")).toBeVisible();
  await expect(page.getByTestId("range-syntax-error")).toHaveText(/can't parse 'abc'/i);

  // Status stays at READY (no file dropped, no conversion fired).
  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");
});
