import path from "node:path";
import { expect, test } from "@playwright/test";

test("multi-image PDF conversion produces zero outbound network requests beyond initial load", async ({
  page,
}) => {
  const PAGE_PATH = "/tools/image-to-pdf";

  const loadRequests: string[] = [];
  page.on("request", (req) => {
    loadRequests.push(req.url());
  });
  await page.goto(PAGE_PATH, { waitUntil: "networkidle" });

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
    if (new URL(ws.url()).host !== new URL(page.url()).host) {
      conversionWebSockets.push(ws.url());
    }
  });

  // Use a HEIC + PNG mix to exercise the lazy libheif load path.
  const input = page.locator('input[type="file"]');
  await input.setInputFiles([
    path.resolve(__dirname, "../fixtures/sample.heic"),
    path.resolve(__dirname, "../fixtures/sample.png"),
  ]);

  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });
  await page.waitForLoadState("networkidle");

  expect(
    conversionRequests,
    `image-to-pdf made off-origin requests: ${conversionRequests.join(", ")}`,
  ).toEqual([]);
  expect(
    conversionWebSockets,
    `image-to-pdf opened off-origin WebSockets: ${conversionWebSockets.join(", ")}`,
  ).toEqual([]);
});
