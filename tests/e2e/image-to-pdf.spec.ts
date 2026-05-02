import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("multi-image drop produces a downloadable PDF (happy path)", async ({ page }) => {
  await page.goto("/tools/image-to-pdf");

  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");
  await expect(page.getByTestId("convert-button")).toBeDisabled();

  const input = page.locator('input[type="file"]');
  await input.setInputFiles([
    path.resolve(__dirname, "../fixtures/sample.png"),
    path.resolve(__dirname, "../fixtures/sample.jpg"),
    path.resolve(__dirname, "../fixtures/sample.webp"),
  ]);

  await expect(page.getByTestId("image-to-pdf-staging")).toBeVisible();
  await expect(page.getByTestId("staging-row")).toHaveCount(3);
  await expect(page.getByTestId("convert-button")).not.toBeDisabled();

  // Reorder: move the second row up.
  const upButtons = page.getByTestId("move-up");
  await upButtons.nth(1).click();

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
  const bytes = await readFile(dlPath);
  // %PDF- magic bytes.
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(1000);
});

test("HEIC + PNG mix produces a downloadable PDF (shared decoder)", async ({ page }) => {
  await page.goto("/tools/image-to-pdf");

  const input = page.locator('input[type="file"]');
  await input.setInputFiles([
    path.resolve(__dirname, "../fixtures/sample.heic"),
    path.resolve(__dirname, "../fixtures/sample.png"),
  ]);

  await expect(page.getByTestId("staging-row")).toHaveCount(2);

  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });
  await page.getByRole("button", { name: /^download / }).click();
  const download = await downloadPromise;
  const dlPath = await download.path();
  const bytes = await readFile(dlPath);
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
});
