import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const fix = (name: string) => path.resolve(__dirname, "../fixtures", name);

test("multi-token range produces N output PDFs + ZIP download (happy path)", async ({ page }) => {
  await page.goto("/tools/pdf-split");

  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix("sample-5page.pdf"));

  await page.getByTestId("range-input").fill("1-3, 5");

  await page.getByTestId("convert-button").click();

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

  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix("sample-5page.pdf"));

  await page.getByTestId("range-input").fill("1-3");

  await page.getByTestId("convert-button").click();

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

  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix("sample-encrypted.pdf"));

  await page.getByTestId("range-input").fill("1");

  await page.getByTestId("convert-button").click();

  // Worker throws "pdf-split: input PDF is password-protected" → ToolFrame
  // error banner.
  await expect(page.getByTestId("status-indicator")).toHaveText("[ ERROR ]", {
    timeout: 15_000,
  });
  await expect(page.getByText(/password-protected/i)).toBeVisible();
});

test("out-of-bounds range surfaces error banner", async ({ page }) => {
  await page.goto("/tools/pdf-split");

  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix("sample-5page.pdf"));

  await page.getByTestId("range-input").fill("9");

  await page.getByTestId("convert-button").click();

  await expect(page.getByTestId("status-indicator")).toHaveText("[ ERROR ]", {
    timeout: 15_000,
  });
  await expect(page.getByText(/exceeds 5/i)).toBeVisible();
});

test("inline syntax error blocks Convert", async ({ page }) => {
  await page.goto("/tools/pdf-split");

  // Type a malformed range. The panel shows inline error immediately.
  // We don't drop a file because this test verifies the panel-level
  // error path (engine.isReadyToConvert only checks non-empty, not
  // syntax validity — the panel's error is the primary user feedback).
  await page.getByTestId("range-input").fill("1, abc, 3");

  await expect(page.getByTestId("range-syntax-error")).toBeVisible();
  await expect(page.getByTestId("range-syntax-error")).toHaveText(/can't parse 'abc'/i);

  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");
  await expect(page.getByTestId("convert-button")).toBeDisabled();
});
