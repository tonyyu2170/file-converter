import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const fix = (name: string) => path.resolve(__dirname, "../fixtures", name);

test("5-page PDF with default options produces a non-empty .md download", async ({ page }) => {
  await page.goto("/tools/pdf-to-md");

  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix("sample-5page.pdf"));

  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByTestId("convert-button").click();

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });

  // Per-row download button — basename + .md (case-insensitive).
  const downloadButton = page.getByRole("button", { name: /sample-5page\.md/i });
  await expect(downloadButton).toBeVisible();

  // Single output → no ZIP-all button.
  await expect(page.getByTestId("download-all-zip")).not.toBeVisible();

  await downloadButton.click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^sample-5page\.md$/i);

  const dlPath = await download.path();
  const bytes = await readFile(dlPath);
  expect(bytes.length).toBeGreaterThan(0);

  const content = bytes.toString("utf8");
  // Default pageBreaks=horizontal-rule; 5-page PDF should contain at least
  // one `---` separator between pages.
  expect(content).toMatch(/^---$/m);
});

test("pageBreaks=none produces output without horizontal rules", async ({ page }) => {
  await page.goto("/tools/pdf-to-md");

  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix("sample-5page.pdf"));

  await page.getByTestId("pdf-to-md-page-breaks").getByRole("radio", { name: /none/i }).check();

  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByTestId("convert-button").click();

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });

  await page.getByRole("button", { name: /sample-5page\.md/i }).click();
  const download = await downloadPromise;

  const bytes = await readFile(await download.path());
  const content = bytes.toString("utf8");

  // No `---` line emitted as a page-break separator.
  expect(content).not.toMatch(/^---$/m);
});

test("encrypted PDF surfaces error banner", async ({ page }) => {
  await page.goto("/tools/pdf-to-md");

  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix("sample-encrypted.pdf"));

  await page.getByTestId("convert-button").click();

  await expect(page.getByTestId("status-indicator")).toHaveText("[ ERROR ]", {
    timeout: 15_000,
  });
  await expect(page.getByText(/password-protected/i)).toBeVisible();
});
