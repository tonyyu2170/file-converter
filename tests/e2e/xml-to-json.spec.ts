import path from "node:path";
import { expect, test } from "@playwright/test";

const FIX = path.resolve(__dirname, "../fixtures/data");

test("xml-to-json: sample.xml → JSON output", async ({ page }) => {
  await page.goto("/tools/xml-to-json");
  await page.locator('input[type="file"]').setInputFiles(path.join(FIX, "sample.xml"));
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 30_000 });
  await expect(page.getByText(/sample\.json/).first()).toBeVisible();
});

test("xml-to-json: $_ prefix toggle works", async ({ page }) => {
  await page.goto("/tools/xml-to-json");
  await page.getByLabel("$_").click();
  await page.locator('input[type="file"]').setInputFiles(path.join(FIX, "sample.xml"));
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 30_000 });
});
