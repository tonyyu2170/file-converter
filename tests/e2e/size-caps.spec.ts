import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

test.describe("size caps", () => {
  let tmpDir: string;
  let hugePdfPath: string;

  test.beforeAll(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "filecnv-sizecaps-"));
    hugePdfPath = path.join(tmpDir, "huge.pdf");
    // 600 MB all-zero; the cap check reads File.size only, so content
    // is irrelevant.
    await writeFile(hugePdfPath, Buffer.alloc(600_000_000, 0));
  }, 60_000);

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
});
