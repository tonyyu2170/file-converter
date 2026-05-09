import path from "node:path";
import { expect, test } from "@playwright/test";

const FIX = path.resolve(__dirname, "../fixtures/data");

test("json-format: pretty (default) on sample.json", async ({ page }) => {
  await page.goto("/tools/json-format");
  await page.locator('input[type="file"]').setInputFiles(path.join(FIX, "sample.json"));
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 30_000 });
  await expect(page.getByText(/sample\.json/).first()).toBeVisible();
});

test("json-format: minify mode hides indent options", async ({ page }) => {
  await page.goto("/tools/json-format");
  await page.getByLabel("minify").click();
  await expect(page.getByLabel("2")).not.toBeVisible();
  await expect(page.getByLabel("4")).not.toBeVisible();
  await expect(page.getByLabel("tab")).not.toBeVisible();
});

test("json-format: indent 4 toggles correctly", async ({ page }) => {
  await page.goto("/tools/json-format");
  await page.getByLabel("4").click();
  await page.locator('input[type="file"]').setInputFiles(path.join(FIX, "sample.json"));
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 30_000 });
});
