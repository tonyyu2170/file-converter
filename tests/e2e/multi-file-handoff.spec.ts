import path from "node:path";
import { expect, test } from "@playwright/test";

test("homepage multi-file drop hands off to image-to-pdf with files staged", async ({ page }) => {
  await page.goto("/");

  const input = page.locator('input[type="file"]');
  await input.setInputFiles([
    path.resolve(__dirname, "../fixtures/sample.png"),
    path.resolve(__dirname, "../fixtures/sample.jpg"),
    path.resolve(__dirname, "../fixtures/sample.webp"),
  ]);

  // Cross-route handoff to image-to-pdf with files populated in staging.
  await page.waitForURL("**/tools/image-to-pdf");

  await expect(page.getByTestId("image-to-pdf-staging")).toBeVisible();
  await expect(page.getByTestId("staging-row")).toHaveCount(3);

  // Convert button is enabled (paper has a default value, ready=true).
  const convertButton = page.getByTestId("convert-button");
  await expect(convertButton).not.toBeDisabled();

  await convertButton.click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: /^download / })).toBeVisible();
});
