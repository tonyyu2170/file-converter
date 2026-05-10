import { expect, test } from "@playwright/test";

test("/tools/video-convert renders the tool frame and shows status [ READY ]", async ({ page }) => {
  await page.goto("/tools/video-convert");
  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");
});

test("video-convert shows the three format radios and the quality select", async ({ page }) => {
  await page.goto("/tools/video-convert");
  for (const fmt of ["mp4", "mov", "webm"]) {
    await expect(page.getByLabel(new RegExp(`^${fmt}$`, "i"))).toBeVisible();
  }
  await expect(page.getByLabel(/quality/i)).toBeVisible();
});

test("video-convert shows the latency-expectation tooltip", async ({ page }) => {
  await page.goto("/tools/video-convert");
  await expect(page.getByText(/typically takes ~1 minute per minute of video/i)).toBeVisible();
});
