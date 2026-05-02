import path from "node:path";
import { expect, test } from "@playwright/test";

test("homepage multi-PDF drop hands off to pdf-merge with files staged", async ({ page }) => {
  await page.goto("/");

  const input = page.locator('input[type="file"]');
  await input.setInputFiles([
    path.resolve(__dirname, "../fixtures/sample-2page.pdf"),
    path.resolve(__dirname, "../fixtures/sample-5page.pdf"),
  ]);

  await page.waitForURL("**/tools/pdf-merge");

  await expect(page.getByTestId("pdf-merge-staging")).toBeVisible();
  await expect(page.getByTestId("staging-row")).toHaveCount(2);

  await expect(page.getByText("2 pages")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("5 pages")).toBeVisible({ timeout: 10_000 });

  const convertButton = page.getByTestId("convert-button");
  await expect(convertButton).not.toBeDisabled();

  await convertButton.click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 30_000 });
  await expect(page.getByRole("button", { name: /^download / })).toBeVisible();
});

test("homepage single-PDF drop shows 'Need 2+ PDFs' error", async ({ page }) => {
  await page.goto("/");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles([path.resolve(__dirname, "../fixtures/sample-2page.pdf")]);

  // Should NOT navigate; should show inline error.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("output[role], output").first()).toContainText(/Need 2\+ PDFs/i);
});

test("homepage mixed drop shows 'same type' error", async ({ page }) => {
  await page.goto("/");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles([
    path.resolve(__dirname, "../fixtures/sample-2page.pdf"),
    path.resolve(__dirname, "../fixtures/sample.png"),
  ]);

  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("output[role], output").first()).toContainText(/same type/i);
});
