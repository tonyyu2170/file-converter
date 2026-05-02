import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const fix = (name: string) => path.resolve(__dirname, "../fixtures", name);

test("5-page PDF + default options (PNG, all pages) produces 5 PNGs + ZIP download", async ({
  page,
}) => {
  await page.goto("/tools/pdf-to-image");

  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix("sample-5page.pdf"));

  await page.getByTestId("convert-button").click();

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });

  // Verify per-row outputs page-1.png through page-5.png.
  for (const n of [1, 2, 3, 4, 5]) {
    await expect(page.getByText(`page-${n}.png`)).toBeVisible();
  }

  // Verify the download-all-zip button is present and shows count = 5.
  const zipButton = page.getByTestId("download-all-zip");
  await expect(zipButton).toBeVisible();
  await expect(zipButton).toHaveText(/download all \(5\) as zip/i);

  // Click ZIP, capture download.
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await zipButton.click();
  const download = await downloadPromise;

  // Filename = `<basename>-images.zip` (uses archiveSuffix: "-images").
  expect(download.suggestedFilename()).toMatch(/sample-5page-images\.zip$/i);

  // ZIP magic: `PK\x03\x04` local file header.
  const dlPath = await download.path();
  const bytes = await readFile(dlPath);
  expect(bytes[0]).toBe(0x50); // P
  expect(bytes[1]).toBe(0x4b); // K
  expect(bytes[2]).toBe(0x03);
  expect(bytes[3]).toBe(0x04);
  expect(bytes.length).toBeGreaterThan(500);
});

test("JPEG format produces .jpg outputs", async ({ page }) => {
  await page.goto("/tools/pdf-to-image");

  // Switch format to JPEG.
  await page
    .getByTestId("pdf-to-image-format")
    .getByRole("radio", { name: /jpeg/i })
    .check();

  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix("sample-5page.pdf"));

  await page.getByTestId("convert-button").click();

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });

  // Filenames should end in .jpg, not .png.
  await expect(page.getByText("page-1.jpg")).toBeVisible();
  await expect(page.getByText("page-1.png")).not.toBeVisible();
});

test("single-page selection (range '3') produces 1 PNG, no ZIP button", async ({ page }) => {
  await page.goto("/tools/pdf-to-image");

  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix("sample-5page.pdf"));

  await page.getByTestId("range-input").fill("3");

  await page.getByTestId("convert-button").click();

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });

  await expect(page.getByText("page-3.png")).toBeVisible();
  // No download-all-zip button when items.length === 1.
  await expect(page.getByTestId("download-all-zip")).not.toBeVisible();

  // Per-row download produces a PNG (8-byte signature).
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("button", { name: /^download page-3\.png$/i }).click();
  const download = await downloadPromise;
  const bytes = await readFile(await download.path());
  expect(bytes[0]).toBe(0x89);
  expect(bytes[1]).toBe(0x50); // P
  expect(bytes[2]).toBe(0x4e); // N
  expect(bytes[3]).toBe(0x47); // G
  expect(bytes[4]).toBe(0x0d);
  expect(bytes[5]).toBe(0x0a);
  expect(bytes[6]).toBe(0x1a);
  expect(bytes[7]).toBe(0x0a);
});

test("encrypted PDF surfaces error banner", async ({ page }) => {
  await page.goto("/tools/pdf-to-image");

  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix("sample-encrypted.pdf"));

  await page.getByTestId("convert-button").click();

  // Worker throws "pdf-to-image: input PDF is password-protected".
  await expect(page.getByTestId("status-indicator")).toHaveText("[ ERROR ]", {
    timeout: 15_000,
  });
  await expect(page.getByText(/password-protected/i)).toBeVisible();
});
