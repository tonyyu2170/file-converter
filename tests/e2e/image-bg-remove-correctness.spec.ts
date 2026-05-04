import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

// =====================================================================
// Status: SKIPPED on Playwright's default Chromium. See block comment
// below for the environmental requirements and the two failure modes
// observed during Phase 16 / Task 8.
//
// To run locally on a machine that meets the requirements:
//   RUN_BG_REMOVE_CORRECTNESS=1 pnpm test:e2e --project=chromium \
//     tests/e2e/image-bg-remove-correctness.spec.ts
// =====================================================================
//
// What this suite is supposed to do
// ---------------------------------
// Drive four real conversions through the dev server, decode the
// resulting PNGs in-page, and assert structural properties:
//   - PNG magic bytes (output is a real PNG, not truncated)
//   - alpha-coverage is in a fixture-specific range (regression tripwire)
//   - solid-mode output has zero translucent pixels (compositing works)
//
// Why this is currently skipped (the two environmental walls)
// -----------------------------------------------------------
// We ship `model_fp16.onnx` (114 MB) for size reasons. ONNX Runtime's
// WebGPU EP requires the adapter's `shader-f16` feature to execute fp16
// ops; without it, ORT throws:
//
//   "The device (webgpu) does not support fp16."
//
// at session creation. The model loader (src/engines/image-bg-remove/
// model-loader.ts) probes for `shader-f16` and falls back to the WASM
// EP when absent — that fallback is the right behaviour for real users
// on machines without WebGPU/shader-f16. Two distinct things still
// block this suite on Playwright's bundled Chromium:
//
// 1) Headless Chromium uses SwiftShader (CPU rasterizer) and does not
//    advertise `shader-f16`, so the WebGPU branch fails at session
//    creation. The model loader's fallback then routes to WASM EP.
//
// 2) Headed Chromium with --enable-unsafe-webgpu --use-angle=metal does
//    light up WebGPU, but the bundled adapter caps
//    `maxStorageBuffersPerShaderStage` at the WebGPU spec minimum (10);
//    the BiRefNet shader needs 11. ORT throws:
//
//      "Too many storage buffers in shader. Current: 11, Max is 10"
//
//    Real-world Chromium running against a discrete GPU on macOS/Windows
//    typically reports limits ≥ 16; this is a Playwright-Chromium-on-Mac
//    constraint, not a model bug.
//
// 3) On the WASM fallback, on the user's 8 GB dev box, ORT throws
//    `std::bad_alloc` mid-inference. The fp16 ONNX is 114 MB but
//    activation tensors balloon past the available headroom. The user's
//    CLAUDE.md flags 8 GB as the floor; production users on similar
//    hardware would hit the same OOM and the engine would need a
//    smaller (e.g. int8-quantized) variant or a hard "needs X GB free"
//    pre-flight check before this is shippable to all users.
//
// What's needed to enable this suite
// ----------------------------------
// Run on a machine that meets BOTH:
//   - WebGPU adapter with `shader-f16` AND
//     `maxStorageBuffersPerShaderStage >= 11`. Discrete GPU on a recent
//     Chromium release usually qualifies.
//   - OR: ≥ 16 GB free RAM so the WASM EP fallback path doesn't OOM.
//
// Then opt in by setting RUN_BG_REMOVE_CORRECTNESS=1 in the env. The
// tests below exercise the path real users take and assert structural
// correctness. Do not silently relax the assertions — if a fixture
// fails on a capable host, that's signal.

const SHOULD_RUN = process.env.RUN_BG_REMOVE_CORRECTNESS === "1";

// Run sequentially: each test loads the ~114 MB model and runs inference.
// `mode: "serial"` keeps a single browser context alive across tests in
// this file but resets the page (and therefore the persistent harness /
// model cache) between them — that's intentional: each test exercises
// the cold-load path the way real users hit it on first visit.
test.describe.configure({ mode: "serial", timeout: 240_000 });

const FIXTURES = [
  // Product on white BG: the model should isolate the subject and leave
  // most of the white background transparent. Coverage upper bound is
  // generous (0.6) because product silhouettes vary.
  { file: "product-on-white.jpg", alphaCoverageRange: [0.05, 0.6] as const },
  // Cluttered portrait. The plan's original range was [0.18, 0.35]; we
  // widened the upper bound to 0.45 because the new fixture (Osama
  // Madlom's "Sun Goddess") has long flowing red hair, so the subject
  // occupies more pixels than a typical bust portrait.
  { file: "portrait-cluttered-bg.jpg", alphaCoverageRange: [0.18, 0.45] as const },
  // Failure-mode case: transparent glass. We don't assert correctness —
  // the model has known difficulty with translucent objects — only that
  // it produces *some* output without throwing. The wide 0–0.95 range
  // is a tripwire for catastrophic regression (e.g., output is fully
  // opaque or fully transparent), not a correctness gate.
  { file: "transparent-glass.jpg", alphaCoverageRange: [0.0, 0.95] as const },
];

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decode a PNG/JPEG blob in the page context and return per-pixel alpha
 * statistics. Runs in real Chromium (not jsdom), so OffscreenCanvas and
 * createImageBitmap are available and behave the way they will in production. */
async function alphaStats(
  page: import("@playwright/test").Page,
  bytes: Buffer,
  mime: string,
): Promise<{ totalPixels: number; opaquePixels: number; translucentPixels: number }> {
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
      bitmap.close();
      return {
        totalPixels: data.length / 4,
        opaquePixels: opaque,
        translucentPixels: translucent,
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
  },
);
