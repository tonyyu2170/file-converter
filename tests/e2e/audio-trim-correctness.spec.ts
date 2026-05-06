import { promises as fs } from "node:fs";
import { type Page, expect, test } from "@playwright/test";

// Gated by RUN_AUDIO_TRIM_CORRECTNESS=1. The suite drives real ffmpeg.wasm
// trims, verifies that the output container is correct and (for the WAV
// re-encode case) parses the output's WAV header to confirm the duration
// matches the requested range.
//
// Usage:
//   RUN_AUDIO_TRIM_CORRECTNESS=1 pnpm test:e2e --project=chromium \
//     tests/e2e/audio-trim-correctness.spec.ts
const SHOULD_RUN = process.env.RUN_AUDIO_TRIM_CORRECTNESS === "1";

test.skip(!SHOULD_RUN, "set RUN_AUDIO_TRIM_CORRECTNESS=1 to run");

test.describe.configure({ mode: "serial", timeout: 240_000 });

const FIXTURE = "tests/fixtures/audio/sample.mp3";

/** Read the canonical-PCM WAV duration from a buffer by parsing the RIFF
 *  header. Assumes a single 'fmt ' (16 bytes) and a single 'data' chunk —
 *  exactly what `pcm_s16le` ffmpeg output produces. */
function wavDurationSeconds(buf: Buffer): number {
  if (buf.subarray(0, 4).toString("utf8") !== "RIFF") {
    throw new Error("not a RIFF file");
  }
  if (buf.subarray(8, 12).toString("utf8") !== "WAVE") {
    throw new Error("not a WAVE file");
  }
  const numChannels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);
  // Find the 'data' chunk (skip non-data chunks like 'LIST' if present).
  let p = 12;
  while (p + 8 <= buf.length) {
    const id = buf.subarray(p, p + 4).toString("utf8");
    const size = buf.readUInt32LE(p + 4);
    if (id === "data") {
      const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
      return size / byteRate;
    }
    p += 8 + size;
  }
  throw new Error("no 'data' chunk found");
}

/** Drive the end handle backward by ArrowLeft (1 s/press) until
 *  aria-valuenow reaches the target (within 0.5 s). Uses 1-second steps
 *  rather than Shift+ArrowLeft (10-second steps) to avoid overshooting on
 *  short fixtures like the 5-second sample.mp3. */
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

test.describe("audio-trim correctness", () => {
  test("same-format trim with default range (no trim) produces a non-empty output", async ({
    page,
  }) => {
    await page.goto("/tools/audio-trim");
    await page.locator('input[type="file"]').first().setInputFiles(FIXTURE);
    await expect(page.getByTestId("trim-scrubber")).toBeVisible({ timeout: 10_000 });

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
    expect(stat.size).toBeGreaterThan(1000); // mp3 is small but non-trivial
    const inStat = await fs.stat(FIXTURE);
    // -c copy with the same range produces a file very close to the input size.
    expect(stat.size).toBeGreaterThan(inStat.size * 0.5);
    expect(stat.size).toBeLessThan(inStat.size * 1.5);
  });

  test("format change to wav produces a RIFF/WAVE file matching the trimmed duration", async ({
    page,
  }) => {
    await page.goto("/tools/audio-trim");
    await page.locator('input[type="file"]').first().setInputFiles(FIXTURE);
    await expect(page.getByTestId("trim-scrubber")).toBeVisible({ timeout: 10_000 });

    // Read the initial endSec (= durationSec) so we know what to subtract from.
    const endHandle = page.getByRole("slider", { name: /trim end/i });
    const initialEnd = Number((await endHandle.getAttribute("aria-valuenow")) ?? "0");
    expect(initialEnd).toBeGreaterThan(0);

    // Shorten the end by 1 s (ArrowLeft = 1 s/step). If the fixture is too
    // short to shorten (< 2 s), we skip keyboard driving and convert at full
    // duration — which still exercises the re-encode path.
    let expectedEnd = initialEnd;
    if (initialEnd >= 2) {
      const targetEnd = initialEnd - 1;
      await pressArrowLeftUntil(page, targetEnd);
      // Re-read after keyboard driver (may have stopped at a clamped value).
      expectedEnd = Number((await endHandle.getAttribute("aria-valuenow")) ?? "0");
      expect(expectedEnd).toBeGreaterThan(0);
    }

    // Switch output format to wav so the worker re-encodes (single ffmpeg call,
    // single-threaded core).
    await page.getByLabel(/output format/i).selectOption("wav");

    // Snapshot endSec immediately before clicking convert so the assertion
    // uses the value the worker will receive.
    const finalEnd = Number((await endHandle.getAttribute("aria-valuenow")) ?? "0");

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

    const buf = await fs.readFile(outPath);
    expect(buf.subarray(0, 4).toString("utf8")).toBe("RIFF");
    expect(buf.subarray(8, 12).toString("utf8")).toBe("WAVE");

    const decodedDur = wavDurationSeconds(buf);
    // startSec is 0 (default), endSec ≈ finalEnd. Allow ±0.3 s of slack
    // because ffmpeg's -ss/-to with -c:a pcm_s16le cuts on sample boundaries.
    expect(decodedDur).toBeGreaterThan(finalEnd - 0.3);
    expect(decodedDur).toBeLessThan(finalEnd + 0.3);
  });
});
