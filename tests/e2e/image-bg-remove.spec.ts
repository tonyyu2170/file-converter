import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

// =====================================================================
// Happy-path E2E for the image-bg-remove engine.
//
// Drives two distinct UI flows end-to-end against the dev server:
//   1. Default transparent-background flow → output is a real PNG
//      and suggested filename is `<name>-nobg.png`.
//   2. Solid-background JPEG flow → toggling output to JPEG reveals
//      the quality slider, output is a real JPEG, suggested filename
//      is `<name>-nobg.jpg`.
//
// Timeout note: the 120_000 ms DONE budget is defensive headroom for
// the cold-load model fetch (~6.6 MB MODNet int8). Warm runs in the
// same browser context complete in under a second; the second test
// in this file reuses the loaded model.
//
// Chromium-only in v1; Firefox/WebKit deferred per spec § 10.3.
// =====================================================================

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_SOI = Buffer.from([0xff, 0xd8]);

test("transparent-bg PNG happy path", async ({ page }) => {
  await page.goto("/tools/image-bg-remove", { waitUntil: "networkidle" });

  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  const fixture = path.resolve(__dirname, "../fixtures/bg-remove/product-on-white.jpg");
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page.getByTestId("convert-button").click();

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 120_000,
  });

  const downloadButton = page.getByRole("button", { name: /^download / });
  await expect(downloadButton).toBeVisible();

  const downloadPromise = page.waitForEvent("download", { timeout: 10_000 });
  await downloadButton.click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/-nobg\.png$/);

  const dlPath = await download.path();
  const bytes = await readFile(dlPath);
  expect(bytes.subarray(0, 4)).toEqual(PNG_MAGIC);
  expect(bytes.length).toBeGreaterThan(1000);
});

test("solid-bg JPEG happy path with quality slider", async ({ page }) => {
  await page.goto("/tools/image-bg-remove", { waitUntil: "networkidle" });

  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  // Toggle bg mode → solid, output → jpeg, then assert the quality
  // slider becomes visible (it's hidden in PNG mode).
  await page.getByTestId("bg-mode-solid").click();
  await page.getByTestId("output-jpeg").click();
  await expect(page.getByTestId("quality-slider")).toBeVisible();

  const fixture = path.resolve(__dirname, "../fixtures/bg-remove/product-on-white.jpg");
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page.getByTestId("convert-button").click();

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 120_000,
  });

  const downloadButton = page.getByRole("button", { name: /^download / });
  await expect(downloadButton).toBeVisible();

  const downloadPromise = page.waitForEvent("download", { timeout: 10_000 });
  await downloadButton.click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/-nobg\.jpg$/);

  const dlPath = await download.path();
  const bytes = await readFile(dlPath);
  expect(bytes.subarray(0, 2)).toEqual(JPEG_SOI);
  expect(bytes.length).toBeGreaterThan(1000);
});
