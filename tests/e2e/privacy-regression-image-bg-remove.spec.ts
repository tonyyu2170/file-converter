import path from "node:path";
import { expect, test } from "@playwright/test";

// =====================================================================
// Privacy regression for the image-bg-remove engine.
//
// This is the load-bearing test of the engine's privacy guarantee:
// during a real conversion (drop file → convert → DONE) every HTTP
// request and WebSocket open MUST be same-origin. Includes the model
// fetch (~7 MB MODNet int8 served from /models/bg-remove/...) and the
// onnxruntime-web wasm bundle (/onnx-wasm/...) — both same-origin
// against the dev server, so they don't trigger the off-origin filter.
//
// A future regression that flips `env.allowRemoteModels = true` or
// permits a transformers.js CDN tokenizer fallback fails this test
// loudly with the leaked URL surfaced in the assertion message.
//
// Mirrors the shape of `privacy-regression-image-convert.spec.ts`:
// listeners are reset after the initial page-goto so we measure
// only the conversion-time network activity, not the dev-server's
// HMR / Next chunk loads from the page navigation itself.
// =====================================================================

test("bg-remove conversion produces zero off-origin requests including model load", async ({
  page,
}) => {
  const PAGE_PATH = "/tools/image-bg-remove";

  // First, do the initial page load with no filtering — Next.js dev
  // chunks, fonts, etc. are noise we don't want to assert on.
  await page.goto(PAGE_PATH, { waitUntil: "networkidle" });

  // Reset listeners; from here forward we track every request whose
  // origin differs from the page's origin. Same-origin model and
  // wasm-runtime fetches (the bulk of bg-remove's network surface)
  // pass the filter cleanly.
  page.removeAllListeners("request");
  const offOriginRequests: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.origin !== new URL(page.url()).origin) {
      offOriginRequests.push(req.url());
    }
  });
  const offOriginWebSockets: string[] = [];
  page.on("websocket", (ws) => {
    if (new URL(ws.url()).host !== new URL(page.url()).host) {
      offOriginWebSockets.push(ws.url());
    }
  });

  const fixture = path.resolve(__dirname, "../fixtures/bg-remove/product-on-white.jpg");
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page.getByTestId("convert-button").click();

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 120_000,
  });
  await page.waitForLoadState("networkidle");

  expect(
    offOriginRequests,
    `bg-remove made off-origin requests: ${offOriginRequests.join(", ")}`,
  ).toEqual([]);
  expect(
    offOriginWebSockets,
    `bg-remove opened off-origin WebSockets: ${offOriginWebSockets.join(", ")}`,
  ).toEqual([]);
});
