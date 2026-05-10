import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Gated by RUN_VIDEO_CONVERT_CORRECTNESS=1. The suite drives real ffmpeg.wasm
// transcode (cold-load + run) for each output format and is slow; we don't
// want it on every CI pass.
//
// To run locally:
//   RUN_VIDEO_CONVERT_CORRECTNESS=1 pnpm test:e2e --project=chromium \
//     tests/e2e/video-convert-correctness.spec.ts
//
// WebM (libvpx VP8) is intentionally NOT exercised here. The libvpx-vp9
// path in the current @ffmpeg/core build OOBs on real inputs (verified
// 2026-05-09); we fell back to libvpx VP8, which works correctly but takes
// many minutes per second of source even with MT enabled. Putting that on
// the correctness suite would burn ~10 minutes per run for marginal value
// over the existing magic-byte coverage of mp4 + mov. WebM transcode is
// instead verified manually per the PR test plan.

const SHOULD_RUN = process.env.RUN_VIDEO_CONVERT_CORRECTNESS === "1";

test.describe.configure({ mode: "serial", timeout: 240_000 });

const FIXTURE = "sample-h264-aac.mp4";
const OUTPUT_FORMATS = ["mp4", "mov"] as const;

// Magic-byte signatures for the output containers.
//   mp4 + mov: ISO BMFF — bytes 4..8 are "ftyp". The brand at bytes 8..12
//              distinguishes mp4 vs mov (mov uses a "qt"-prefixed brand).
const MAGIC: Record<(typeof OUTPUT_FORMATS)[number], (b: Buffer) => boolean> = {
  mp4: (b) =>
    b.subarray(4, 8).toString("ascii") === "ftyp" &&
    !b.subarray(8, 10).toString("ascii").startsWith("qt"),
  mov: (b) =>
    b.subarray(4, 8).toString("ascii") === "ftyp" &&
    b.subarray(8, 10).toString("ascii").startsWith("qt"),
};

const guarded = SHOULD_RUN ? test : test.skip;

for (const outFmt of OUTPUT_FORMATS) {
  guarded(
    `video-convert ${FIXTURE} → .${outFmt} produces a valid ${outFmt} file`,
    async ({ page }) => {
      await page.goto("/tools/video-convert");
      await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

      const fixture = path.resolve(__dirname, "../fixtures/video", FIXTURE);
      await page.locator('input[type="file"]').setInputFiles(fixture);

      await page.getByLabel(new RegExp(`^${outFmt}$`, "i")).click();
      // Quality "low" (CRF 28) keeps the test fast.
      await page.getByLabel(/quality/i).selectOption("low");

      await page.getByTestId("convert-button").click();

      await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
        timeout: 200_000,
      });

      const downloadButton = page.getByRole("button", { name: /^download / });
      const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
      await downloadButton.click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${outFmt}$`, "i"));

      const dlPath = await download.path();
      const bytes = await readFile(dlPath);
      expect(bytes.length).toBeGreaterThan(100);
      expect(MAGIC[outFmt](bytes)).toBe(true);
    },
  );
}
