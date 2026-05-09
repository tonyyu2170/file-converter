import path from "node:path";
import { expect, test } from "@playwright/test";

test("xml-to-json produces zero off-origin requests during conversion", async ({ page }) => {
  page.on("request", () => undefined);
  await page.goto("/tools/xml-to-json", { waitUntil: "networkidle" });
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
    .setInputFiles(path.resolve(__dirname, "../fixtures/data/sample.xml"));
  await page.getByTestId("convert-button").click();
  await expect(page.getByTestId("status-indicator")).toHaveText("[ DONE ]", { timeout: 30_000 });
  await page.waitForLoadState("networkidle");

  expect(off, `xml-to-json made off-origin requests: ${off.join(", ")}`).toEqual([]);
  expect(ws, `xml-to-json opened off-origin WebSockets: ${ws.join(", ")}`).toEqual([]);
});
