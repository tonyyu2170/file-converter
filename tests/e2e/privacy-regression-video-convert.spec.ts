import path from "node:path";
import { expect, test } from "@playwright/test";

// =====================================================================
// Privacy regression for the video-convert engine.
//
// During a real conversion (drop file → pick output → convert → DONE),
// every HTTP request and WebSocket open MUST be same-origin. Includes
// the ffmpeg-core fetch (~30 MB ffmpeg-core.wasm + worker JS from
// /ffmpeg/...) — same-origin against the dev server.
//
// A future regression that lets ffmpeg fall back to unpkg.com (its
// default coreURL/wasmURL) would fail this test loudly with the leaked
// URL surfaced in the assertion message.
//
// Output format chosen as mp4 (libx264) — fastest transcode in this
// build. WebM (libvpx) is correct but slow enough to make this gate
// unbearable on every CI pass.
//
// Listeners are reset after the initial page-goto so we measure only
// conversion-time network activity, not Next dev-server HMR / chunk loads.
// =====================================================================

test("video-convert conversion produces zero off-origin requests including ffmpeg-core load", async ({
  page,
}) => {
  test.setTimeout(240_000);

  const PAGE_PATH = "/tools/video-convert";

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
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page.getByLabel(/^mp4$/i).click();
  await page.getByLabel(/quality/i).selectOption("low");
  await page.getByTestId("convert-button").click();

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 200_000,
  });
  await page.waitForLoadState("networkidle");

  expect(
    offOriginRequests,
    `video-convert made off-origin requests: ${offOriginRequests.join(", ")}`,
  ).toEqual([]);
  expect(
    offOriginWebSockets,
    `video-convert opened off-origin WebSockets: ${offOriginWebSockets.join(", ")}`,
  ).toEqual([]);
});
