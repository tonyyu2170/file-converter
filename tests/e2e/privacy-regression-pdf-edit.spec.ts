import path from "node:path";
import { expect, test } from "@playwright/test";

test("pdf-edit produces zero off-origin requests during conversion", async ({ page }) => {
  const PAGE_PATH = "/tools/pdf-edit";

  // Drain initial-load requests.
  page.on("request", () => undefined);
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

  const input = page.locator('input[type="file"]');
  await input.setInputFiles(
    path.resolve(__dirname, "../fixtures/pdf-edit/multi-page.pdf"),
  );

  // Wait for the host's useEffect to seed pages (5 cells).
  await expect(page.getByTestId("page-indicator")).toHaveText("5 pages", {
    timeout: 10_000,
  });

  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", {
    timeout: 30_000,
  });
  await page.waitForLoadState("networkidle");

  expect(
    conversionRequests,
    `pdf-edit made off-origin requests: ${conversionRequests.join(", ")}`,
  ).toEqual([]);
  expect(
    conversionWebSockets,
    `pdf-edit opened off-origin WebSockets: ${conversionWebSockets.join(", ")}`,
  ).toEqual([]);
});
