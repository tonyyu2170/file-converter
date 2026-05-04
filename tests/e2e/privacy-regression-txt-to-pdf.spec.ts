import path from "node:path";
import { expect, test } from "@playwright/test";

test("txt-to-pdf produces zero off-origin requests during conversion", async ({ page }) => {
  // Drain initial-load requests.
  page.on("request", () => undefined);
  await page.goto("/tools/txt-to-pdf", { waitUntil: "networkidle" });
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

  // txt-to-pdf fetches /fonts/ from same origin — allowed by filter above.
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(path.resolve(__dirname, "../fixtures/sample.txt"));
  await page.getByTestId("convert-button").click();

  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });
  await page.waitForLoadState("networkidle");

  expect(
    conversionRequests,
    `txt-to-pdf made off-origin requests: ${conversionRequests.join(", ")}`,
  ).toEqual([]);
  expect(
    conversionWebSockets,
    `txt-to-pdf opened off-origin WebSockets: ${conversionWebSockets.join(", ")}`,
  ).toEqual([]);
});
