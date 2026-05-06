import { expect, test } from "@playwright/test";

test("/tools/audio-convert renders the tool frame and shows status [ READY ]", async ({ page }) => {
  await page.goto("/tools/audio-convert");
  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");
});

test("audio-convert shows the four format options", async ({ page }) => {
  await page.goto("/tools/audio-convert");
  for (const fmt of ["mp3", "wav", "m4a", "flac"]) {
    await expect(page.getByLabel(new RegExp(`^${fmt}`, "i"))).toBeVisible();
  }
});

test("audio-convert shows bitrate dropdown only for lossy formats", async ({ page }) => {
  await page.goto("/tools/audio-convert");
  // Default outputFormat is null, so no bitrate dropdown initially.
  await expect(page.getByLabel(/bitrate/i)).not.toBeVisible();
  // Pick mp3 (lossy) — bitrate appears.
  await page.getByLabel(/^mp3/i).click();
  await expect(page.getByLabel(/bitrate/i)).toBeVisible();
  // Pick wav (lossless) — bitrate hides.
  await page.getByLabel(/^wav/i).click();
  await expect(page.getByLabel(/bitrate/i)).not.toBeVisible();
});
