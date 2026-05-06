import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Gated by RUN_AUDIO_CONVERT_CORRECTNESS=1. The suite drives real ffmpeg.wasm
// inference (cold-load + run) and is slow; we don't want it on every CI pass.
//
// To run locally:
//   RUN_AUDIO_CONVERT_CORRECTNESS=1 pnpm test:e2e --project=chromium \
//     tests/e2e/audio-convert-correctness.spec.ts

const SHOULD_RUN = process.env.RUN_AUDIO_CONVERT_CORRECTNESS === "1";

test.describe.configure({ mode: "serial", timeout: 240_000 });

const FIXTURES = [
  { file: "sample.mp3", inputFmt: "mp3" },
  { file: "sample.wav", inputFmt: "wav" },
  { file: "sample.m4a", inputFmt: "m4a" },
  { file: "sample.flac", inputFmt: "flac" },
] as const;

const OUTPUT_FORMATS = ["mp3", "wav", "m4a", "flac"] as const;

const MAGIC: Record<(typeof OUTPUT_FORMATS)[number], (b: Buffer) => boolean> = {
  // ID3v2 header "ID3" or MPEG sync word at offset 0
  mp3: (b) =>
    (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || // ID3
    (b[0] === 0xff && (b[1] === 0xfb || b[1] === 0xf3 || b[1] === 0xf2)),
  wav: (b) =>
    b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WAVE",
  m4a: (b) => b.subarray(4, 8).toString("ascii") === "ftyp",
  flac: (b) => b.subarray(0, 4).toString("ascii") === "fLaC",
};

const guarded = SHOULD_RUN ? test : test.skip;

for (const fx of FIXTURES) {
  for (const outFmt of OUTPUT_FORMATS) {
    guarded(
      `audio-convert ${fx.file} → .${outFmt} produces a valid ${outFmt} file`,
      async ({ page }) => {
        await page.goto("/tools/audio-convert");
        await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

        const fixture = path.resolve(__dirname, "../fixtures/audio", fx.file);
        await page.locator('input[type="file"]').setInputFiles(fixture);

        await page.getByLabel(new RegExp(`^${outFmt}`, "i")).click();

        await page.getByTestId("convert-button").click();

        await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
          timeout: 120_000,
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
}
