import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("JPEG → PNG produces a valid PNG download", async ({ page }) => {
  await page.goto("/tools/image-convert");

  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  // DropZone is disabled until output format is picked.
  await expect(page.getByTestId("drop-zone")).toHaveAttribute("data-state", "disabled");

  // Pick PNG output.
  await page.getByTestId("output-format").selectOption("png");

  await expect(page.getByTestId("drop-zone")).not.toHaveAttribute("data-state", "disabled");

  const input = page.locator('input[type="file"]');
  const fixture = path.resolve(__dirname, "../fixtures/sample.jpg");
  await input.setInputFiles(fixture);

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

test("EXIF-rotated JPEG output preserves visual orientation", async ({ page }) => {
  await page.goto("/tools/image-convert");
  await page.getByTestId("output-format").selectOption("jpeg");

  const input = page.locator('input[type="file"]');
  const fixture = path.resolve(__dirname, "../fixtures/sample-rotated.jpg");
  await input.setInputFiles(fixture);

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });

  const downloadPromise = page.waitForEvent("download", { timeout: 5_000 });
  await page.getByRole("button", { name: /^download / }).click();
  const download = await downloadPromise;
  const dlPath = await download.path();
  const bytes = await readFile(dlPath);

  // Decode the output in-browser via createImageBitmap and check dimensions
  // match the visual orientation (post-rotation), not the stored bytes.
  const dims = await page.evaluate(async (b64: string) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: "image/jpeg" });
    const bmp = await createImageBitmap(blob);
    const dims = { width: bmp.width, height: bmp.height };
    bmp.close();
    return dims;
  }, bytes.toString("base64"));

  // Source fixture: 300x200 stored, EXIF Orientation=6 (rotate 90 CW).
  // After auto-rotate, the visible image is 200x300 (portrait).
  expect(dims.width).toBeLessThan(dims.height);
});

test("HEIC → PNG via shared decoder produces a valid PNG download", async ({ page }) => {
  await page.goto("/tools/image-convert");
  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");
  await page.getByTestId("output-format").selectOption("png");

  const input = page.locator('input[type="file"]');
  const fixture = path.resolve(__dirname, "../fixtures/sample.heic");
  await input.setInputFiles(fixture);

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
