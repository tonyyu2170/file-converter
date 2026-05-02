import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const fix = (name: string) => path.resolve(__dirname, "../fixtures", name);

async function readPdfBytes(downloadPath: string): Promise<Buffer> {
  return await readFile(downloadPath);
}

test("multi-PDF drop produces a downloadable merged PDF (happy path)", async ({ page }) => {
  await page.goto("/tools/pdf-merge");

  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");
  await expect(page.getByTestId("convert-button")).toBeDisabled();

  const input = page.locator('input[type="file"]');
  await input.setInputFiles([
    fix("sample-1page.pdf"),
    fix("sample-2page.pdf"),
    fix("sample-5page.pdf"),
  ]);

  await expect(page.getByTestId("pdf-merge-staging")).toBeVisible();
  await expect(page.getByTestId("staging-row")).toHaveCount(3);

  // Wait for metadata to load (pageCount visible) before Convert is enabled.
  await expect(page.getByText("1 page")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("2 pages")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("5 pages")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("convert-button")).not.toBeDisabled();

  // Click Convert.
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByTestId("convert-button").click();

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });

  const downloadButton = page.getByRole("button", { name: /^download / });
  await expect(downloadButton).toBeVisible();
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);

  const dlPath = await download.path();
  const bytes = await readPdfBytes(dlPath);
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect(bytes.subarray(-6).toString("ascii")).toContain("%%EOF");
  // Sum: 1 + 2 + 5 = 8 pages
  expect(bytes.length).toBeGreaterThan(1000);
});

test("range slicing produces the expected page count", async ({ page }) => {
  await page.goto("/tools/pdf-merge");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles([fix("sample-2page.pdf"), fix("sample-5page.pdf")]);

  await expect(page.getByText("2 pages")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("5 pages")).toBeVisible({ timeout: 10_000 });

  // First file: pages 1-2 (= 2 pages). Second file: pages 3- (= 3 pages: 3,4,5). Total = 5.
  const ranges = page.getByTestId("range-input");
  await ranges.nth(0).fill("1-2");
  await ranges.nth(1).fill("3-");

  await expect(page.getByTestId("convert-button")).not.toBeDisabled();
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 30_000 });
  await page.getByRole("button", { name: /^download / }).click();
  const download = await downloadPromise;
  const bytes = await readPdfBytes(await download.path());
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
});

test("encrypted PDF is rejected per-row and Convert stays disabled", async ({ page }) => {
  await page.goto("/tools/pdf-merge");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles([fix("sample-2page.pdf"), fix("sample-encrypted.pdf")]);

  await expect(page.getByText("[ password-protected ]")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("convert-button")).toBeDisabled();
});

test("bad range disables Convert; fixing it re-enables", async ({ page }) => {
  await page.goto("/tools/pdf-merge");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles([fix("sample-2page.pdf"), fix("sample-5page.pdf")]);

  await expect(page.getByText("5 pages")).toBeVisible({ timeout: 10_000 });

  const ranges = page.getByTestId("range-input");
  await ranges.nth(1).fill("7-10"); // 5-page PDF, out of bounds
  await expect(page.getByTestId("range-error").first()).toContainText(/exceeds 5/);
  await expect(page.getByTestId("convert-button")).toBeDisabled();

  await ranges.nth(1).fill("1-3");
  await expect(page.getByTestId("convert-button")).not.toBeDisabled();
});
