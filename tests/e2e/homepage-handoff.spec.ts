import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("homepage HEIC drop hands off to tool page and converts automatically", async ({ page }) => {
  await page.goto("/");

  const input = page.locator('input[type="file"]');
  const fixture = path.resolve(__dirname, "../fixtures/sample.heic");

  await input.setInputFiles(fixture);

  // Cross-route handoff: page navigates to the tool route, ToolFrame consumes
  // the staged file on mount, and the conversion runs without a second drop.
  await page.waitForURL("**/tools/heic-to-png");
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });

  const downloadButton = page.getByRole("button", { name: /^download / });
  await expect(downloadButton).toBeVisible();

  const downloadPromise = page.waitForEvent("download", { timeout: 5_000 });
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/i);
  const dlPath = await download.path();
  const bytes = await readFile(dlPath);
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  expect(bytes.length).toBeGreaterThan(100);
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
