import path from "node:path";
import { expect, test } from "@playwright/test";

// =====================================================================
// Privacy regression for the video-trim engine.
//
// During a real conversion (drop file → convert → DONE → download),
// every HTTP request and WebSocket open MUST be same-origin. Includes
// the ffmpeg-core fetch (~30 MB ffmpeg-core.wasm + ~110 KB ffmpeg-core.js
// from /ffmpeg/...) — same-origin against the dev server.
//
// A future regression that lets ffmpeg fall back to unpkg.com (its
// default coreURL/wasmURL) would fail this test loudly with the leaked
// URL surfaced in the assertion message.
//
// Listeners are reset after the initial page-goto so we measure only
// conversion-time network activity, not Next dev-server HMR / chunk loads.
// =====================================================================

test("video-trim conversion produces zero off-origin requests including ffmpeg-core load", async ({
  page,
}) => {
  const PAGE_PATH = "/tools/video-trim";

  await page.goto(PAGE_PATH, { waitUntil: "networkidle" });

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

  const fixture = path.resolve(__dirname, "../fixtures/video/sample-h264-aac.mp4");
  await page.locator('input[type="file"]').first().setInputFiles(fixture);

  // Wait for the trim scrubber to appear (duration probe done, endSec set).
  await expect(page.getByTestId("trim-scrubber")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("convert-button").click();

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 120_000,
  });

  const downloadButton = page.getByRole("button", { name: /^download / });
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await downloadButton.click();
  await downloadPromise;

  await page.waitForLoadState("networkidle");

  expect(
    offOriginRequests,
    `video-trim made off-origin requests: ${offOriginRequests.join(", ")}`,
  ).toEqual([]);
  expect(
    offOriginWebSockets,
    `video-trim opened off-origin WebSockets: ${offOriginWebSockets.join(", ")}`,
  ).toEqual([]);
});
