import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { expect, test } from "@playwright/test";

const fix = (name: string) => path.resolve(__dirname, "../fixtures", name);
const FIXTURE = fix("pdf-edit/multi-page.pdf");

async function loadPdfFromDownload(downloadPath: string): Promise<PDFDocument> {
  const bytes = await readFile(downloadPath);
  return await PDFDocument.load(bytes);
}

test.describe.configure({ mode: "serial" });

test("pdf-edit: rotate, delete, convert, decode output", async ({ page }) => {
  await page.goto("/tools/pdf-edit");
  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  // Stage the fixture.
  await page.locator('input[type="file"]').setInputFiles(FIXTURE);

  // The OptionsPanel host's useEffect calls loadFileIntoWorker → seeds
  // pages. Wait for all 5 cells to render.
  for (let i = 0; i < 5; i++) {
    await expect(page.getByTestId(`page-cell-${i}`)).toBeVisible({
      timeout: 10_000,
    });
  }
  await expect(page.getByTestId("page-indicator")).toHaveText("5 pages");

  // Rotate page-cell-1 (sourceIndex 1) by 90°.
  await page.getByTestId("page-cell-1").getByTestId("rotate-btn").click();
  await expect(page.getByTestId("page-cell-1")).toHaveAttribute(
    "data-rotation",
    "90",
  );

  // Delete page-cell-4 (sourceIndex 4 — i.e., "page 5").
  await page.getByTestId("page-cell-4").getByTestId("delete-btn").click();
  await expect(page.getByTestId("page-cell-4")).toHaveCount(0);
  await expect(page.getByTestId("page-indicator")).toHaveText(
    "5 pages → 4 pages",
  );

  // Convert — two-step: click Convert, wait for DONE, then click Download.
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });

  // Click the download button to trigger the file save (same two-step
  // flow as pdf-merge.spec.ts).
  const downloadButton = page.getByRole("button", { name: /^download / });
  await expect(downloadButton).toBeVisible();
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/multi-page-edited\.pdf$/);

  // Decode the downloaded PDF with pdf-lib (Node side) and verify.
  const dlPath = await download.path();
  const bytes = await readFile(dlPath);
  expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");

  const outDoc = await loadPdfFromDownload(dlPath);
  const outPages = outDoc.getPages();
  expect(outPages.length).toBe(4);

  // Source rotations: [0, 0, 90, 0, 0]. We rotated page 1 (sourceIndex 1)
  // by 90 and deleted page 4 (sourceIndex 4). The output is sourceIndex
  // sequence [0, 1, 2, 3] with composed rotations:
  //   sourceIndex 0: source 0  + user 0  = 0
  //   sourceIndex 1: source 0  + user 90 = 90
  //   sourceIndex 2: source 90 + user 0  = 90  (source page already at 90°)
  //   sourceIndex 3: source 0  + user 0  = 0
  expect(outPages[0]!.getRotation().angle).toBe(0);
  expect(outPages[1]!.getRotation().angle).toBe(90);
  expect(outPages[2]!.getRotation().angle).toBe(90);
  expect(outPages[3]!.getRotation().angle).toBe(0);
});
