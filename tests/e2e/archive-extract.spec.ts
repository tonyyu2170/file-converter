import path from "node:path";
import { expect, test } from "@playwright/test";

const FIX = path.resolve(__dirname, "../fixtures/archives");

test("archive-extract: happy path drops sample.zip and lists 2 entries", async ({ page }) => {
  await page.goto("/tools/archive-extract");
  await page.locator('input[type="file"]').setInputFiles(path.join(FIX, "sample.zip"));
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 30_000 });
  await expect(page.getByText("hello.txt")).toBeVisible();
  await expect(page.getByText("data/notes.md")).toBeVisible();
});

test("archive-extract: encrypted zip shows actionable error", async ({ page }) => {
  await page.goto("/tools/archive-extract");
  await page.locator('input[type="file"]').setInputFiles(path.join(FIX, "encrypted.zip"));
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ ERROR ]", { timeout: 30_000 });
  await expect(page.getByText(/password-protected ZIPs/i)).toBeVisible();
});

test("archive-extract: zip-slip shows actionable error with offending path", async ({ page }) => {
  await page.goto("/tools/archive-extract");
  await page.locator('input[type="file"]').setInputFiles(path.join(FIX, "zip-slip.zip"));
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ ERROR ]", { timeout: 30_000 });
  await expect(page.getByText(/unsafe path.*\.\.\/escape\.txt/)).toBeVisible();
});

test("archive-extract: download-all-as-zip uses archiveSuffix", async ({ page }) => {
  await page.goto("/tools/archive-extract");
  await page.locator('input[type="file"]').setInputFiles(path.join(FIX, "sample.zip"));
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 30_000 });
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByTestId("download-all-zip").click();
  const dl = await downloadPromise;
  expect(dl.suggestedFilename()).toBe("sample-extract.zip");
});
