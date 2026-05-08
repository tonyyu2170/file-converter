import path from "node:path";
import { expect, test } from "@playwright/test";

// =====================================================================
// Privacy regression for the image-to-text engine.
//
// During a real conversion (drop file → convert → DONE), every HTTP
// request and WebSocket open MUST be same-origin. Includes the Tesseract
// cold-start fetches (worker.min.js, tesseract-core.wasm, eng.traineddata
// — all served from /tesseract/ same-origin) — if any of these fall back
// to tessdata.projectnaptha.com or cdn.jsdelivr.net, this test fails
// loudly with the leaked URL in the assertion message.
//
// Listeners are reset after the initial page-goto so we measure only
// conversion-time network activity, not Next dev-server HMR / chunk loads.
// =====================================================================

test("image-to-text conversion produces zero off-origin requests including tesseract cold-start", async ({
  page,
}) => {
  const PAGE_PATH = "/tools/image-to-text";

  // First, do the initial page load with no filtering — Next.js dev
  // chunks, fonts, etc. are noise we don't want to assert on.
  await page.goto(PAGE_PATH, { waitUntil: "networkidle" });

  // Reset listeners; from here forward we track every request whose
  // origin differs from the page's origin.
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

  const fixture = path.resolve(
    __dirname,
    "../fixtures/image-to-text/screenshot.png",
  );
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page.getByTestId("convert-button").click();

  // Tesseract cold-start (worker spawn + wasm + traineddata) takes a few
  // seconds; 120 s matches the project-wide conversion timeout.
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 120_000,
  });
  await page.waitForLoadState("networkidle");

  expect(
    offOriginRequests,
    `image-to-text made off-origin requests: ${offOriginRequests.join(", ")}`,
  ).toEqual([]);
  expect(
    offOriginWebSockets,
    `image-to-text opened off-origin WebSockets: ${offOriginWebSockets.join(", ")}`,
  ).toEqual([]);
});
