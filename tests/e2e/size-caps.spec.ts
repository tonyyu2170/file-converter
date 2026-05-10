import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

test.describe("size caps", () => {
  let tmpDir: string;
  let hugePdfPath: string;
  let hugeMp4Path: string;

  test.beforeAll(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "filecnv-sizecaps-"));
    hugePdfPath = path.join(tmpDir, "huge.pdf");
    hugeMp4Path = path.join(tmpDir, "huge.mp4");
    // Sparse files; the cap check reads File.size only, so content is
    // irrelevant. Using truncate keeps Node heap near-zero (vs Buffer.alloc
    // which would allocate the full size per worker).
    const fh = await open(hugePdfPath, "w");
    await fh.truncate(600_000_000);
    await fh.close();
    // 200 MB > video category's 100 MB hard cap.
    const fhMp4 = await open(hugeMp4Path, "w");
    await fhMp4.truncate(200_000_000);
    await fhMp4.close();
  });

  test.afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("drops a 600 MB file into pdf-merge and gets the hard-cap rejection", async ({ page }) => {
    await page.goto("/tools/pdf-merge");

    const input = page.locator('input[type="file"]');
    await input.setInputFiles([hugePdfPath]);

    await expect(page.getByText(/exceeds the 500 MB cap for pdf tools/i)).toBeVisible();
    await expect(page.getByTestId("status-indicator")).toHaveText("[ ERROR ]");

    // Convert button must remain disabled because no files were staged.
    await expect(page.getByTestId("convert-button")).toBeDisabled();
  });

  test("drops a 200 MB file into video-convert and gets the hard-cap rejection", async ({
    page,
  }) => {
    await page.goto("/tools/video-convert");

    const input = page.locator('input[type="file"]');
    await input.setInputFiles([hugeMp4Path]);

    await expect(page.getByText(/exceeds the 100 MB cap for video tools/i)).toBeVisible();
    await expect(page.getByTestId("status-indicator")).toHaveText("[ ERROR ]");
    await expect(page.getByTestId("convert-button")).toBeDisabled();
  });
});
