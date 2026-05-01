import path from "node:path";
import { expect, test } from "@playwright/test";

test("HEIC conversion produces zero outbound network requests beyond initial load", async ({
  page,
}) => {
  const PAGE_PATH = "/tools/heic-to-png";

  // Phase 1: load the page. Capture every request the page makes during initial load.
  const loadRequests: string[] = [];
  page.on("request", (req) => {
    loadRequests.push(req.url());
  });
  await page.goto(PAGE_PATH, { waitUntil: "networkidle" });

  // Phase 2: clear the listener and start a fresh request log scoped to off-origin only.
  page.removeAllListeners("request");
  const conversionRequests: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.origin !== new URL(page.url()).origin) {
      conversionRequests.push(req.url());
    }
  });
  const conversionWebSockets: string[] = [];
  page.on("websocket", (ws) => {
    const origin = new URL(ws.url()).origin;
    if (origin !== new URL(page.url()).origin) {
      conversionWebSockets.push(ws.url());
    }
  });

  // Phase 3: run a real HEIC conversion.
  const input = page.locator('input[type="file"]');
  const fixture = path.resolve(__dirname, "../fixtures/sample.heic");
  await input.setInputFiles(fixture);
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });
  // Catch deferred (setTimeout-style) exfiltration that lands after `done`.
  await page.waitForLoadState("networkidle");

  // Phase 4: assert.
  expect(
    conversionRequests,
    `HEIC conversion made off-origin requests: ${conversionRequests.join(", ")}`,
  ).toEqual([]);
  expect(
    conversionWebSockets,
    `HEIC conversion opened off-origin WebSockets: ${conversionWebSockets.join(", ")}`,
  ).toEqual([]);
});
