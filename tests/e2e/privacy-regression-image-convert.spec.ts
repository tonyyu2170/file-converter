import path from "node:path";
import { expect, test } from "@playwright/test";

test("JPEG → PNG conversion produces zero outbound network requests beyond initial load", async ({
  page,
}) => {
  const PAGE_PATH = "/tools/image-convert";

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

  await page.getByTestId("output-format").selectOption("png");
  const input = page.locator('input[type="file"]');
  const fixture = path.resolve(__dirname, "../fixtures/sample.jpg");
  await input.setInputFiles(fixture);
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 30_000 });
  await page.waitForLoadState("networkidle");

  expect(
    conversionRequests,
    `Image-convert made off-origin requests: ${conversionRequests.join(", ")}`,
  ).toEqual([]);
  expect(
    conversionWebSockets,
    `Image-convert opened off-origin WebSockets: ${conversionWebSockets.join(", ")}`,
  ).toEqual([]);
});

test("HEIC → PNG conversion produces zero outbound network requests beyond initial load", async ({
  page,
}) => {
  const PAGE_PATH = "/tools/image-convert";

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

  await page.getByTestId("output-format").selectOption("png");
  const input = page.locator('input[type="file"]');
  const fixture = path.resolve(__dirname, "../fixtures/sample.heic");
  await input.setInputFiles(fixture);
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 30_000 });
  await page.waitForLoadState("networkidle");

  expect(
    conversionRequests,
    `Image-convert HEIC made off-origin requests: ${conversionRequests.join(", ")}`,
  ).toEqual([]);
  expect(
    conversionWebSockets,
    `Image-convert HEIC opened off-origin WebSockets: ${conversionWebSockets.join(", ")}`,
  ).toEqual([]);
});
