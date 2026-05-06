import { expect, test } from "@playwright/test";

test.describe("/tools/audio-trim", () => {
  test("loads, renders the status indicator and the format dropdown", async ({ page }) => {
    await page.goto("/tools/audio-trim");
    await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");
    await expect(page.getByLabel(/output format/i)).toBeVisible();
  });

  test("upload widget accepts mp3/wav/m4a/flac extensions", async ({ page }) => {
    await page.goto("/tools/audio-trim");
    const input = page.locator('input[type="file"]').first();
    const accept = await input.getAttribute("accept");
    expect(accept ?? "").toMatch(/\.mp3/);
    expect(accept ?? "").toMatch(/\.wav/);
    expect(accept ?? "").toMatch(/\.m4a/);
    expect(accept ?? "").toMatch(/\.flac/);
  });

  test("staging a file shows the trim scrubber", async ({ page }) => {
    await page.goto("/tools/audio-trim");
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles("tests/fixtures/audio/sample.mp3");
    await expect(page.getByTestId("trim-scrubber")).toBeVisible({ timeout: 10_000 });
  });
});
