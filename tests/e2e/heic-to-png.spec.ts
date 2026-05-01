import { expect, test } from "@playwright/test";
import path from "node:path";

test("HEIC to PNG produces a downloadable PNG", async ({ page }) => {
  await page.goto("/tools/heic-to-png");

  const main = page.locator("main");
  await expect(main.getByTestId("status-indicator")).toHaveText("[ READY ]");

  const input = main.locator('input[type="file"]');
  const fixture = path.resolve(__dirname, "../fixtures/sample.heic");

  // Set up the download promise BEFORE triggering the conversion.
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });

  await input.setInputFiles(fixture);

  // Wait for terminal state. We do NOT assert the intermediate `[ CONVERTING ]`
  // text — for a small fixture HEIC, the conversion finishes in 100–500ms,
  // which is faster than Playwright can poll. Asserting that intermediate
  // would flake on a perfectly-working app.
  await expect(main.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });

  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/i);
});
