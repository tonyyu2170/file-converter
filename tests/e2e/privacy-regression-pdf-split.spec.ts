import path from "node:path";
import { expect, test } from "@playwright/test";

test("pdf-split produces zero off-origin requests during conversion", async ({ page }) => {
  // Drain initial-load requests.
  page.on("request", () => undefined);
  await page.goto("/tools/pdf-split", { waitUntil: "networkidle" });
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

  // Type range first to enable DropZone, then drop file.
  await page.getByTestId("range-input").fill("1-3, 5");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(path.resolve(__dirname, "../fixtures/sample-5page.pdf"));

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });
  await page.waitForLoadState("networkidle");

  expect(
    conversionRequests,
    `pdf-split made off-origin requests: ${conversionRequests.join(", ")}`,
  ).toEqual([]);
  expect(
    conversionWebSockets,
    `pdf-split opened off-origin WebSockets: ${conversionWebSockets.join(", ")}`,
  ).toEqual([]);
});

test("pdf-split ZIP download produces zero off-origin requests", async ({ page }) => {
  await page.goto("/tools/pdf-split", { waitUntil: "networkidle" });

  // Type range first, drop file, await conversion completion.
  await page.getByTestId("range-input").fill("1-3, 5");
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(path.resolve(__dirname, "../fixtures/sample-5page.pdf"));
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });
  await page.waitForLoadState("networkidle");

  // Reset listeners now — we only care about the ZIP-build path.
  page.removeAllListeners("request");
  page.removeAllListeners("websocket");
  const zipRequests: string[] = [];
  const zipWebSockets: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.origin !== new URL(page.url()).origin) zipRequests.push(req.url());
  });
  page.on("websocket", (ws) => {
    if (new URL(ws.url()).host !== new URL(page.url()).host) zipWebSockets.push(ws.url());
  });

  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByTestId("download-all-zip").click();
  await downloadPromise;
  await page.waitForLoadState("networkidle");

  expect(zipRequests).toEqual([]);
  expect(zipWebSockets).toEqual([]);
});
