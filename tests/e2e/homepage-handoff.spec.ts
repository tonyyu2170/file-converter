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

  // ToolFrame holds the file in pendingFiles state because no output format
  // is selected. Conversion has NOT fired yet.
  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");
  await expect(page.getByTestId("drop-zone")).toHaveAttribute("data-state", "disabled");

  // User selects PNG. The pending-files watcher fires conversion.
  await page.getByTestId("output-format").selectOption("png");

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

  // ToolFrame holds the file in pendingFiles state because no output format
  // is selected. Conversion has NOT fired yet.
  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");
  await expect(page.getByTestId("drop-zone")).toHaveAttribute("data-state", "disabled");

  // User selects PNG. The pending-files watcher re-runs and fires conversion.
  await page.getByTestId("output-format").selectOption("png");

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: /^download / })).toBeVisible();
});
