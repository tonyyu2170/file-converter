import { expect, test } from "@playwright/test";

test.describe("/tools/video-trim", () => {
  test("loads and renders the status indicator and container dropdown", async ({ page }) => {
    await page.goto("/tools/video-trim");
    await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");
    await expect(page.getByLabel(/output container/i)).toBeVisible();
  });

  test("upload widget accepts mp4/mov/webm/mkv extensions", async ({ page }) => {
    await page.goto("/tools/video-trim");
    const input = page.locator('input[type="file"]').first();
    const accept = await input.getAttribute("accept");
    expect(accept ?? "").toMatch(/\.mp4/);
    expect(accept ?? "").toMatch(/\.mov/);
    expect(accept ?? "").toMatch(/\.webm/);
    expect(accept ?? "").toMatch(/\.mkv/);
  });

  test("staging a file shows the trim scrubber", async ({ page }) => {
    await page.goto("/tools/video-trim");
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles("tests/fixtures/video/sample-h264-aac.mp4");
    await expect(page.getByTestId("trim-scrubber")).toBeVisible({ timeout: 15_000 });
  });
});
