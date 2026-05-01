import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("HEIC to PNG produces a downloadable PNG", async ({ page }) => {
  await page.goto("/tools/heic-to-png");

  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  const input = page.locator('input[type="file"]');
  const fixture = path.resolve(__dirname, "../fixtures/sample.heic");

  // Set up the download promise BEFORE triggering the conversion.
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });

  await input.setInputFiles(fixture);

  // Wait for terminal state. We do NOT assert the intermediate `[ CONVERTING ]`
  // text — for a small fixture HEIC, the conversion finishes in 100–500ms,
  // which is faster than Playwright can poll. Asserting that intermediate
  // would flake on a perfectly-working app.
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });

  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/i);
  const dlPath = await download.path();
  const bytes = await readFile(dlPath);
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  expect(bytes.length).toBeGreaterThan(100);
});
