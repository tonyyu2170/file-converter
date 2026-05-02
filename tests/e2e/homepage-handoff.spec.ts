import path from "node:path";
import { expect, test } from "@playwright/test";

test("homepage HEIC drop hands off to image-convert; conversion fires after format selection", async ({
  page,
}) => {
  await page.goto("/");

  const input = page.locator('input[type="file"]');
  const fixture = path.resolve(__dirname, "../fixtures/sample.heic");
  await input.setInputFiles(fixture);

  await page.waitForURL("**/tools/image-convert");

  // The handed-off file is staged but no output format is selected, so
  // Convert is not yet enabled.
  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  await page.getByTestId("output-format").selectOption("png");
  await page.getByTestId("convert-button").click();

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: /^download / })).toBeVisible();
});

test("homepage JPEG drop hands off to image-convert; conversion fires after format selection", async ({
  page,
}) => {
  await page.goto("/");

  const input = page.locator('input[type="file"]');
  const fixture = path.resolve(__dirname, "../fixtures/sample.jpg");
  await input.setInputFiles(fixture);

  // Cross-route handoff to image-convert.
  await page.waitForURL("**/tools/image-convert");

  // The handed-off file is staged but no output format is selected, so
  // Convert is not yet enabled.
  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  await page.getByTestId("output-format").selectOption("png");
  await page.getByTestId("convert-button").click();

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: /^download / })).toBeVisible();
});
