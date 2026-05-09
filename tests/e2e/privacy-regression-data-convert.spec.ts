import path from "node:path";
import { expect, test } from "@playwright/test";

test("data-convert produces zero off-origin requests during conversion", async ({ page }) => {
  page.on("request", () => undefined);
  await page.goto("/tools/data-convert", { waitUntil: "networkidle" });
  page.removeAllListeners("request");

  const off: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.origin !== new URL(page.url()).origin) off.push(req.url());
  });
  const ws: string[] = [];
  page.on("websocket", (w) => {
    if (new URL(w.url()).host !== new URL(page.url()).host) ws.push(w.url());
  });

  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve(__dirname, "../fixtures/data/sample.csv"));
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 30_000 });
  await page.waitForLoadState("networkidle");

  expect(off, `data-convert made off-origin requests: ${off.join(", ")}`).toEqual([]);
  expect(ws, `data-convert opened off-origin WebSockets: ${ws.join(", ")}`).toEqual([]);
});
