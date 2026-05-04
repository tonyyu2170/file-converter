import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

// =====================================================================
// Status: gated behind RUN_BG_REMOVE_CORRECTNESS=1. The suite drives
// real model inference (cold-load + run on three fixtures plus a
// solid-mode composite check) and is slow + RAM-touchy enough that we
// don't want it on every CI pass.
//
// To run locally:
//   RUN_BG_REMOVE_CORRECTNESS=1 pnpm test:e2e --project=chromium \
//     tests/e2e/image-bg-remove-correctness.spec.ts
// =====================================================================
//
// What this suite does
// --------------------
// Drives four real conversions through the dev server, decodes the
// resulting PNGs in-page, and asserts structural properties:
//   - PNG magic bytes (output is a real PNG, not truncated)
//   - alpha-coverage is in a fixture-specific range (regression tripwire)
//   - solid-mode output has zero translucent pixels (compositing works)
//
// Environmental notes
// -------------------
// The engine ships `model_quantized.onnx` (~6.6 MB int8 MODNet). On
// Playwright's bundled Chromium the WebGPU adapter (SwiftShader headless
// or the capped Metal adapter when headed) typically does not advertise
// `shader-f16`, so the model loader's `pickDevice` probe routes to WASM
// EP — q8's documented-default execution path. That path runs cleanly on
// 8 GB hosts (the prior fp16 BiRefNet build OOM'd here, which is why the
// model was swapped).
//
// Do not silently relax the alpha-coverage assertions. If a fixture
// fails on a capable host that's signal — either a regression in the
// model bytes (sha256-checked at install) or a regression in the
// pre/post-processing harness.

const SHOULD_RUN = process.env.RUN_BG_REMOVE_CORRECTNESS === "1";

// Run sequentially: each test loads the ~6.6 MB model and runs inference.
// `mode: "serial"` keeps a single browser context alive across tests in
// this file but resets the page (and therefore the persistent harness /
// model cache) between them — that's intentional: each test exercises
// the cold-load path the way real users hit it on first visit.
test.describe.configure({ mode: "serial", timeout: 240_000 });

// Expected dims are hardcoded (verified once via `sips -g pixelWidth -g
// pixelHeight tests/fixtures/bg-remove/<file>`). The fixtures are committed
// at known sizes; if the assertion fails, either the fixture was rotated/
// resized in the repo (update this table) or the engine inadvertently
// resized the output (a real regression — spec § 10.2 requires output dims
// match input dims exactly).
const FIXTURES = [
  // Product on white BG: the model should isolate the subject and leave
  // most of the white background transparent. Coverage upper bound is
  // generous (0.6) because product silhouettes vary. Lower bound widened
  // from 0.05 → 0.02 because MODNet produces a tighter mask than
  // BiRefNet on this fixture (observed 0.039); 0.02 still catches an
  // empty-output regression while clearing MODNet's actual baseline.
  {
    file: "product-on-white.jpg",
    alphaCoverageRange: [0.02, 0.6] as const,
    expectedWidth: 1600,
    expectedHeight: 1128,
  },
  // Cluttered portrait. The original BiRefNet-tuned range was
  // [0.18, 0.45]; widened upper bound from 0.45 → 0.55 because MODNet
  // is portrait-optimized and produces a denser mask on this fixture
  // (observed 0.483). 0.55 still catches a fully-opaque-output
  // regression (would be ~1.0) and a wrong-subject regression.
  {
    file: "portrait-cluttered-bg.jpg",
    alphaCoverageRange: [0.18, 0.55] as const,
    expectedWidth: 1280,
    expectedHeight: 1600,
  },
  // Failure-mode case: transparent glass. We don't assert correctness —
  // the model has known difficulty with translucent objects — only that
  // it produces *some* output without throwing. The wide 0–0.95 range
  // is a tripwire for catastrophic regression (e.g., output is fully
  // opaque or fully transparent), not a correctness gate.
  {
    file: "transparent-glass.jpg",
    alphaCoverageRange: [0.0, 0.95] as const,
    expectedWidth: 1028,
    expectedHeight: 1600,
  },
];

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decode a PNG/JPEG blob in the page context and return per-pixel alpha
 * statistics plus output dimensions. Runs in real Chromium (not jsdom), so
 * OffscreenCanvas and createImageBitmap are available and behave the way
 * they will in production. */
async function alphaStats(
  page: import("@playwright/test").Page,
  bytes: Buffer,
  mime: string,
): Promise<{
  totalPixels: number;
  opaquePixels: number;
  translucentPixels: number;
  width: number;
  height: number;
}> {
  return await page.evaluate(
    async ({ b64, mime }) => {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const blob = new Blob([arr], { type: mime });
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let opaque = 0;
      let translucent = 0;
      for (let i = 3; i < data.length; i += 4) {
        const a = data[i] as number;
        if (a > 128) opaque += 1;
        if (a < 255) translucent += 1;
      }
      const width = bitmap.width;
      const height = bitmap.height;
      bitmap.close();
      return {
        totalPixels: data.length / 4,
        opaquePixels: opaque,
        translucentPixels: translucent,
        width,
        height,
      };
    },
    { b64: bytes.toString("base64"), mime },
  );
}

const guarded = SHOULD_RUN ? test : test.skip;

for (const fx of FIXTURES) {
  guarded(`bg-remove produces sensible alpha coverage on ${fx.file}`, async ({ page }) => {
    await page.goto("/tools/image-bg-remove");

    await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

    const fixture = path.resolve(__dirname, "../fixtures/bg-remove", fx.file);
    await page.locator('input[type="file"]').setInputFiles(fixture);
    await page.getByTestId("convert-button").click();

    // First-conversion model load can take ~30–90s. The 200_000 ms budget
    // leaves headroom under the test-level 240_000 ms timeout for the
    // download + decode that follow.
    await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
      timeout: 200_000,
    });

    const downloadButton = page.getByRole("button", { name: /^download / });
    await expect(downloadButton).toBeVisible();

    const downloadPromise = page.waitForEvent("download", { timeout: 10_000 });
    await downloadButton.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.png$/i);

    const dlPath = await download.path();
    const bytes = await readFile(dlPath);

    // Valid PNG magic bytes — file is not truncated or mistyped.
    expect(bytes.subarray(0, 8)).toEqual(PNG_MAGIC);
    expect(bytes.length).toBeGreaterThan(1000);

    const stats = await alphaStats(page, bytes, "image/png");
    const coverage = stats.opaquePixels / stats.totalPixels;
    expect(coverage).toBeGreaterThanOrEqual(fx.alphaCoverageRange[0]);
    expect(coverage).toBeLessThanOrEqual(fx.alphaCoverageRange[1]);

    // Output dimensions must match input dimensions exactly (spec § 10.2).
    // The fixtures are committed at known sizes; if this fails, either the
    // fixture file changed (update FIXTURES) or the engine inadvertently
    // resized the output (a real regression — the segmentation harness
    // upsamples the model mask to the source resolution before alpha-
    // multiplying).
    expect(stats.width).toBe(fx.expectedWidth);
    expect(stats.height).toBe(fx.expectedHeight);
  });
}

guarded(
  "solid mode produces zero translucent pixels (red bg, product fixture)",
  async ({ page }) => {
    await page.goto("/tools/image-bg-remove");

    await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

    // Switch to solid mode + custom red color. The hex input commits on blur;
    // press Tab to ensure React's synthetic onBlur fires reliably (calling
    // .blur() directly in Playwright doesn't always dispatch it cleanly).
    await page.getByTestId("bg-mode-solid").click();
    const hexInput = page.getByTestId("custom-hex");
    await hexInput.fill("#ff0000");
    await hexInput.press("Tab");

    const fixture = path.resolve(__dirname, "../fixtures/bg-remove/product-on-white.jpg");
    await page.locator('input[type="file"]').setInputFiles(fixture);
    await page.getByTestId("convert-button").click();

    await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
      timeout: 200_000,
    });

    const downloadButton = page.getByRole("button", { name: /^download / });
    const downloadPromise = page.waitForEvent("download", { timeout: 10_000 });
    await downloadButton.click();
    const download = await downloadPromise;

    const dlPath = await download.path();
    const bytes = await readFile(dlPath);
    expect(bytes.subarray(0, 8)).toEqual(PNG_MAGIC);

    const stats = await alphaStats(page, bytes, "image/png");
    // Solid mode composites the subject onto an opaque red background, so
    // every output pixel must have alpha === 255. Using a non-default red
    // (#ff0000, not #ffffff) ensures an output produced by skipping the
    // compositing step entirely would not coincidentally pass.
    expect(stats.translucentPixels).toBe(0);
    // Solid-mode output dims must also match the source product fixture
    // (1600 x 1128). Same regression rationale as the per-fixture block.
    expect(stats.width).toBe(1600);
    expect(stats.height).toBe(1128);
  },
);
