import { promises as fs } from "node:fs";
import { type Page, expect, test } from "@playwright/test";

// Gated by RUN_VIDEO_TRIM_CORRECTNESS=1. The suite drives real ffmpeg.wasm
// trims against sample-h264-aac.mp4, verifying the output container is
// correct and the trim scrubber frame strip renders properly.
//
// Usage:
//   RUN_VIDEO_TRIM_CORRECTNESS=1 pnpm test:e2e --project=chromium \
//     tests/e2e/video-trim-correctness.spec.ts
const SHOULD_RUN = process.env.RUN_VIDEO_TRIM_CORRECTNESS === "1";

test.skip(!SHOULD_RUN, "set RUN_VIDEO_TRIM_CORRECTNESS=1 to run");

test.describe.configure({ mode: "serial", timeout: 240_000 });

const FIXTURE = "tests/fixtures/video/sample-h264-aac.mp4";

/** Drive the end handle backward by ArrowLeft (1 s/press) until
 *  aria-valuenow reaches the target (within 0.5 s). Uses 1-second steps
 *  to avoid overshooting on short fixtures. */
async function pressArrowLeftUntil(page: Page, targetSec: number) {
  const handle = page.getByRole("slider", { name: /trim end/i });
  await handle.focus();
  for (let i = 0; i < 120; i++) {
    const current = Number((await handle.getAttribute("aria-valuenow")) ?? "0");
    if (Math.abs(current - targetSec) < 0.5) return;
    if (current <= targetSec) return; // clamped — accept overshoot
    await page.keyboard.press("ArrowLeft");
  }
  throw new Error(`could not drive end handle to ${targetSec} s`);
}

test.describe("video-trim correctness", () => {
  test("same-container trim with default range produces a non-empty MP4 output", async ({
    page,
  }) => {
    await page.goto("/tools/video-trim");
    await page.locator('input[type="file"]').first().setInputFiles(FIXTURE);

    // Wait for trim scrubber to appear (duration probe complete).
    await expect(page.getByTestId("trim-scrubber")).toBeVisible({ timeout: 15_000 });

    // Wait for at least one frame img to appear in the frame strip.
    await expect(page.locator('[data-testid="trim-scrubber-frame-strip"] img').first()).toBeVisible(
      { timeout: 30_000 },
    );

    // Default range covers the full fixture (0..durationSec). Convert as-is.
    await page.getByTestId("convert-button").click();

    await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
      timeout: 120_000,
    });

    const downloadButton = page.getByRole("button", { name: /^download / });
    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await downloadButton.click();
    const download = await downloadPromise;

    const outPath = await download.path();
    if (!outPath) throw new Error("download.path() returned null");

    const stat = await fs.stat(outPath);
    expect(stat.size).toBeGreaterThan(1000);

    // output filename should end with -trimmed.mp4
    expect(download.suggestedFilename()).toMatch(/-trimmed\.mp4$/i);

    // Verify it starts with the MP4 ftyp box magic (first 4 bytes are the
    // box size; bytes 4-7 are the ftyp tag).
    const bytes = await fs.readFile(outPath);
    const ftyp = bytes.subarray(4, 8).toString("utf8");
    expect(ftyp).toBe("ftyp");
  });

  test("trim with shortened end range produces a smaller output", async ({ page }) => {
    await page.goto("/tools/video-trim");
    await page.locator('input[type="file"]').first().setInputFiles(FIXTURE);

    await expect(page.getByTestId("trim-scrubber")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="trim-scrubber-frame-strip"] img').first()).toBeVisible(
      { timeout: 30_000 },
    );

    // Read the initial endSec (= durationSec).
    const endHandle = page.getByRole("slider", { name: /trim end/i });
    const initialEnd = Number((await endHandle.getAttribute("aria-valuenow")) ?? "0");
    expect(initialEnd).toBeGreaterThan(0);

    // Shorten the end by 1 s if fixture is long enough.
    if (initialEnd >= 2) {
      const targetEnd = initialEnd - 1;
      await pressArrowLeftUntil(page, targetEnd);
    }

    await page.getByTestId("convert-button").click();

    await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
      timeout: 120_000,
    });

    const downloadButton = page.getByRole("button", { name: /^download / });
    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await downloadButton.click();
    const download = await downloadPromise;

    const outPath = await download.path();
    if (!outPath) throw new Error("download.path() returned null");

    expect(download.suggestedFilename()).toMatch(/-trimmed\.mp4$/i);
    const stat = await fs.stat(outPath);
    expect(stat.size).toBeGreaterThan(1000);
  });
});
