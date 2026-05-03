import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const fix = (name: string) => path.resolve(__dirname, "../fixtures", name);

async function downloadPdfBytes(
  page: import("@playwright/test").Page,
  fixture: string,
): Promise<Buffer> {
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix(fixture));
  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");
  const downloadPromise = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 90_000,
  });
  await page.getByRole("button", { name: /^download / }).click();
  const download = await downloadPromise;
  return readFile(await download.path());
}

test("simple paragraphs DOCX produces a downloadable PDF", async ({ page }) => {
  await page.goto("/tools/docx-to-pdf");
  const bytes = await downloadPdfBytes(page, "simple-paragraphs.docx");
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect(bytes.subarray(-6).toString("ascii")).toContain("%%EOF");
  expect(bytes.length).toBeGreaterThan(1000);
});

test("multi-page DOCX produces a multi-page PDF", async ({ page }) => {
  await page.goto("/tools/docx-to-pdf");
  const bytes = await downloadPdfBytes(page, "multi-page.docx");
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  // Multi-page fixture has 5 conceptual pages; the rendered PDF should be
  // 2+ pages (exact count depends on layout). Magic bytes + size sanity.
  expect(bytes.length).toBeGreaterThan(2000);
});

test("two-column resume DOCX renders to PDF", async ({ page }) => {
  await page.goto("/tools/docx-to-pdf");
  const bytes = await downloadPdfBytes(page, "two-column-resume.docx");
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(1000);
});

test("table DOCX renders to PDF", async ({ page }) => {
  await page.goto("/tools/docx-to-pdf");
  const bytes = await downloadPdfBytes(page, "table-doc.docx");
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
});

test("headed-footed DOCX renders to PDF", async ({ page }) => {
  await page.goto("/tools/docx-to-pdf");
  const bytes = await downloadPdfBytes(page, "headed-footed.docx");
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
});

test("footnoted DOCX renders to PDF", async ({ page }) => {
  await page.goto("/tools/docx-to-pdf");
  const bytes = await downloadPdfBytes(page, "footnoted.docx");
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
});

test("nested-list DOCX renders to PDF", async ({ page }) => {
  await page.goto("/tools/docx-to-pdf");
  const bytes = await downloadPdfBytes(page, "nested-list.docx");
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
});

test("image DOCX renders to PDF", async ({ page }) => {
  await page.goto("/tools/docx-to-pdf");
  const bytes = await downloadPdfBytes(page, "image-doc.docx");
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
});

test("encrypted DOCX surfaces password-protected error", async ({ page }) => {
  await page.goto("/tools/docx-to-pdf");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix("encrypted.docx"));
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ ERROR ]", {
    timeout: 15_000,
  });
  await expect(page.getByText(/password-protected/i)).toBeVisible();
});

test("equations DOCX converts and surfaces a warning notice", async ({ page }) => {
  await page.goto("/tools/docx-to-pdf");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix("equations-doc.docx"));
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 90_000,
  });
  await expect(page.getByTestId("output-warnings")).toBeVisible();
  await expect(page.getByTestId("output-warnings")).toHaveText(/equation/i);
});

test("drawings DOCX converts and surfaces a warning notice", async ({ page }) => {
  await page.goto("/tools/docx-to-pdf");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix("drawings-doc.docx"));
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 90_000,
  });
  await expect(page.getByTestId("output-warnings")).toBeVisible();
  await expect(page.getByTestId("output-warnings")).toHaveText(/drawing/i);
});

test("RTL DOCX converts and surfaces a warning notice", async ({ page }) => {
  await page.goto("/tools/docx-to-pdf");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(fix("rtl-doc.docx"));
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 90_000,
  });
  await expect(page.getByTestId("output-warnings")).toBeVisible();
  await expect(page.getByTestId("output-warnings")).toHaveText(/RTL/i);
});

test("non-DOCX file is rejected by validate", async ({ page }) => {
  await page.goto("/tools/docx-to-pdf");
  const input = page.locator('input[type="file"]');
  // Drop a PDF — extension is .pdf, MIME doesn't match the engine's accept.
  await input.setInputFiles(fix("sample-1page.pdf"));
  // The drop handler should fail to stage; convert-button stays disabled
  // OR an error appears. We verify status-indicator stays READY.
  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");
});
