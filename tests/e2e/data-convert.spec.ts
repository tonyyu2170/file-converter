import path from "node:path";
import { expect, test } from "@playwright/test";

const FIX = path.resolve(__dirname, "../fixtures/data");

test("data-convert: csv → json round-trip downloads", async ({ page }) => {
  await page.goto("/tools/data-convert");
  await page.locator('input[type="file"]').setInputFiles(path.join(FIX, "sample.csv"));
  // Default output is JSON; just click convert.
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 30_000 });
  await page.getByLabel(/download sample\.json/).click();
  const dl = await downloadPromise;
  expect(dl.suggestedFilename()).toBe("sample.json");
});

test("data-convert: yaml → csv via output toggle", async ({ page }) => {
  await page.goto("/tools/data-convert");
  await page.locator('input[type="file"]').setInputFiles(path.join(FIX, "sample.yaml"));
  await page.getByLabel("csv").click();
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 30_000 });
  await expect(page.getByText(/sample\.csv/)).toBeVisible();
});

test("data-convert: nested.json → csv shows actionable shape error", async ({ page }) => {
  await page.goto("/tools/data-convert");
  await page.locator('input[type="file"]').setInputFiles(path.join(FIX, "nested.json"));
  await page.getByLabel("csv").click();
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ ERROR ]", { timeout: 30_000 });
  await expect(page.getByText(/nested object at key "address"/)).toBeVisible();
});
