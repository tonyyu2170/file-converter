import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const fix = (name: string) => path.resolve(__dirname, "../fixtures", name);

test("markdown file produces a non-empty PDF download", async ({ page }) => {
  await page.goto("/tools/markdown-to-pdf");

  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix("sample.md"));

  await expect(page.getByTestId("clear-staged-file")).toBeVisible();

  await page.getByTestId("convert-button").click();

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });

  const downloadPromise = page.waitForEvent("download", { timeout: 10_000 });
  await page.getByRole("button", { name: /download sample\.pdf/i }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);

  const dlPath = await download.path();
  if (!dlPath) throw new Error("download path missing");
  const bytes = await readFile(dlPath);

  // Valid PDF starts with %PDF-.
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(1000);
});
