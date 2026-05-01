import { expect, test } from "@playwright/test";

test("conversion produces zero outbound network requests beyond initial load", async ({ page }) => {
  const PAGE_PATH = "/test-only/stub-runner";

  // Phase 1: load the page. Capture every request the page makes during initial load.
  const loadRequests: string[] = [];
  page.on("request", (req) => {
    loadRequests.push(req.url());
  });
  await page.goto(PAGE_PATH, { waitUntil: "networkidle" });

  // Phase 2: clear the listener and start a fresh request log.
  page.removeAllListeners("request");
  const conversionRequests: string[] = [];
  page.on("request", (req) => {
    // Worker fetches its own module — same-origin, expected.
    // We only flag requests that go off-origin.
    const url = new URL(req.url());
    if (url.origin !== new URL(page.url()).origin) {
      conversionRequests.push(req.url());
    }
  });

  // Phase 3: run the conversion.
  await page.getByTestId("run").click();
  await expect(page.getByTestId("status")).toHaveText("done", { timeout: 5000 });

  // Phase 4: assert.
  expect(
    conversionRequests,
    `Conversion made off-origin requests: ${conversionRequests.join(", ")}`,
  ).toEqual([]);

  // Sanity: the conversion did produce output.
  const output = await page.getByTestId("output").textContent();
  expect(output).toContain(".stub");
});
