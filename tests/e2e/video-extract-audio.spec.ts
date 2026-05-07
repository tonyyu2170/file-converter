import { expect, test } from "@playwright/test";

test.describe("/tools/video-extract-audio", () => {
  test("loads and renders the status indicator and format dropdown", async ({ page }) => {
    await page.goto("/tools/video-extract-audio");
    await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");
    await expect(page.getByTestId("video-extract-audio-format")).toBeVisible();
  });

  test("format dropdown has the expected five options in order", async ({ page }) => {
    await page.goto("/tools/video-extract-audio");
    const select = page.getByTestId("video-extract-audio-format");
    const options = await select.locator("option").allTextContents();
    expect(options).toEqual(["same", "mp3", "wav", "m4a", "flac"]);
  });

  test("bitrate dropdown is hidden when format is 'same' (default)", async ({ page }) => {
    await page.goto("/tools/video-extract-audio");
    await expect(page.getByTestId("video-extract-audio-bitrate")).not.toBeVisible();
  });

  test("upload widget accepts mp4/mov/webm/mkv extensions", async ({ page }) => {
    await page.goto("/tools/video-extract-audio");
    const input = page.locator('input[type="file"]').first();
    const accept = await input.getAttribute("accept");
    expect(accept ?? "").toMatch(/\.mp4/);
    expect(accept ?? "").toMatch(/\.mov/);
    expect(accept ?? "").toMatch(/\.webm/);
    expect(accept ?? "").toMatch(/\.mkv/);
  });
});
