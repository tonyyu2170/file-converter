import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const fix = (name: string) => path.resolve(__dirname, "../fixtures", name);

test("resizes a PNG to 100x50 and asserts filename + pixel dimensions", async ({ page }) => {
  await page.goto("/tools/image-resize");

  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix("sample-1000x500.png"));

  await expect(page.getByTestId("clear-staged-file")).toBeVisible();

  // Set width to 100; with lockAspectRatio=true height will be auto 50.
  await page.getByTestId("resize-width").fill("100");

  await page.getByTestId("convert-button").click();

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });

  // Download the result.
  const downloadPromise = page.waitForEvent("download", { timeout: 10_000 });
  await page.getByRole("button", { name: /download sample-1000x500-100x50\.png/i }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/-100x50\.png$/);

  // Decode and assert actual pixel dimensions using the browser's image APIs.
  const dlPath = await download.path();
  if (!dlPath) throw new Error("download path missing");
  const bytes = await readFile(dlPath);

  const dims = await page.evaluate(async (b64: string) => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: "image/png" });
    const bitmap = await createImageBitmap(blob);
    try {
      return { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  }, bytes.toString("base64"));

  expect(dims).toEqual({ width: 100, height: 50 });
});

test("resizes a JPEG and produces a JPEG download", async ({ page }) => {
  await page.goto("/tools/image-resize");
  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix("sample.jpg"));

  await page.getByTestId("resize-width").fill("200");

  await page.getByTestId("convert-button").click();

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });

  const downloadPromise = page.waitForEvent("download", { timeout: 10_000 });
  await page.getByRole("button", { name: /download /i }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.jpg$/i);
});
