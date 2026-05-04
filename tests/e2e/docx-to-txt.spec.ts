import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const fix = (name: string) => path.resolve(__dirname, "../fixtures", name);

test("simple-paragraphs DOCX produces a non-empty .txt download with text content", async ({
  page,
}) => {
  await page.goto("/tools/docx-to-txt");

  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix("simple-paragraphs.docx"));

  await expect(page.getByTestId("clear-staged-file")).toBeVisible();

  await page.getByTestId("convert-button").click();

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });

  const downloadPromise = page.waitForEvent("download", { timeout: 10_000 });
  await page.getByRole("button", { name: /download simple-paragraphs\.txt/i }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.txt$/i);

  const dlPath = await download.path();
  if (!dlPath) throw new Error("download path missing");
  const bytes = await readFile(dlPath);
  expect(bytes.length).toBeGreaterThan(0);

  // The fixture has multiple paragraphs; extracted text must be non-trivial.
  const content = bytes.toString("utf8");
  expect(content.trim().length).toBeGreaterThan(10);
});

test("multi-page DOCX produces a non-empty .txt download", async ({ page }) => {
  await page.goto("/tools/docx-to-txt");
  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix("multi-page.docx"));

  await page.getByTestId("convert-button").click();

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });

  const downloadPromise = page.waitForEvent("download", { timeout: 10_000 });
  await page.getByRole("button", { name: /download multi-page\.txt/i }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.txt$/i);

  const dlPath = await download.path();
  if (!dlPath) throw new Error("download path missing");
  const bytes = await readFile(dlPath);
  expect(bytes.length).toBeGreaterThan(0);
});
