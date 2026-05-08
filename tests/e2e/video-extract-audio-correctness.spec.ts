import { promises as fs } from "node:fs";
import { expect, test } from "@playwright/test";

// Gated by RUN_VIDEO_EXTRACT_AUDIO_CORRECTNESS=1. The suite drives real
// ffmpeg.wasm audio extractions against sample-h264-aac.mp4.
//
// Usage:
//   RUN_VIDEO_EXTRACT_AUDIO_CORRECTNESS=1 pnpm test:e2e --project=chromium \
//     tests/e2e/video-extract-audio-correctness.spec.ts
const SHOULD_RUN = process.env.RUN_VIDEO_EXTRACT_AUDIO_CORRECTNESS === "1";

test.skip(!SHOULD_RUN, "set RUN_VIDEO_EXTRACT_AUDIO_CORRECTNESS=1 to run");

test.describe.configure({ mode: "serial", timeout: 240_000 });

const FIXTURE = "tests/fixtures/video/sample-h264-aac.mp4";

test.describe("video-extract-audio correctness", () => {
  test("default options (format=same, aac source) produces -audio.m4a", async ({ page }) => {
    await page.goto("/tools/video-extract-audio");
    await page.locator('input[type="file"]').first().setInputFiles(FIXTURE);

    // The options panel renders immediately (no scrubber to wait for).
    await expect(page.getByTestId("video-extract-audio-format")).toBeVisible({ timeout: 10_000 });

    // Default format is "same" — bitrate dropdown should stay hidden.
    await expect(page.getByTestId("video-extract-audio-bitrate")).not.toBeVisible();

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

    // sample-h264-aac.mp4 has AAC audio → sameOutputFor("aac") → .m4a
    expect(download.suggestedFilename()).toMatch(/-audio\.m4a$/i);
  });

  test("format=mp3 reveals bitrate dropdown and produces -audio.mp3", async ({ page }) => {
    await page.goto("/tools/video-extract-audio");
    await page.locator('input[type="file"]').first().setInputFiles(FIXTURE);

    await expect(page.getByTestId("video-extract-audio-format")).toBeVisible({ timeout: 10_000 });

    // Switch to mp3 — bitrate dropdown should appear (lossy format).
    await page.getByTestId("video-extract-audio-format").selectOption("mp3");
    await expect(page.getByTestId("video-extract-audio-bitrate")).toBeVisible();

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

    expect(download.suggestedFilename()).toMatch(/-audio\.mp3$/i);

    // Verify MP3 magic bytes (ID3 header or sync word).
    const bytes = await fs.readFile(outPath);
    const isMp3 =
      (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || // "ID3"
      (bytes[0] === 0xff && (bytes[1] === 0xfb || bytes[1] === 0xf3 || bytes[1] === 0xf2));
    expect(isMp3).toBe(true);
  });
});
