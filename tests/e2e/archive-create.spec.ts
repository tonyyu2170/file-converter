import path from "node:path";
import { expect, test } from "@playwright/test";

const FIX = path.resolve(__dirname, "../fixtures/archives");

test("archive-create: drop two files, custom filename, ZIP output", async ({ page }) => {
  await page.goto("/tools/archive-create");
  // Use sample.tar and sample.zip as arbitrary inputs.
  await page
    .locator('input[type="file"]')
    .setInputFiles([path.join(FIX, "sample.tar"), path.join(FIX, "sample.zip")]);
  await page.getByTestId("filename-input").fill("mybundle");
  await expect(page.getByTestId("filename-preview")).toContainText("mybundle.zip");
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 30_000 });
  // Single-output path: one result row with a per-item download button.
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByLabel(/download mybundle\.zip/).click();
  const dl = await downloadPromise;
  expect(dl.suggestedFilename()).toBe("mybundle.zip");
});

test("archive-create: tar.gz format updates extension preview", async ({ page }) => {
  await page.goto("/tools/archive-create");
  await page.getByLabel("tar.gz").click();
  await expect(page.getByTestId("filename-preview")).toContainText(".tar.gz");
});

test("archive-create: invalid filename disables convert", async ({ page }) => {
  await page.goto("/tools/archive-create");
  await page.locator('input[type="file"]').setInputFiles(path.join(FIX, "sample.tar"));
  await page.getByTestId("filename-input").fill("bad name with spaces");
  await expect(page.getByTestId("filename-error")).toBeVisible();
  await expect(page.getByTestId("convert-button")).toBeDisabled();
});
