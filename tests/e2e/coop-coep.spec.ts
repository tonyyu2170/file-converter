import path from "node:path";
import { expect, test } from "@playwright/test";

// Source-of-truth route catalog for COOP/COEP. Update when adding tools.
// (Phase 20 will add `/tools/audio-trim` after rebase — when the rebase
// lands, append `"/tools/audio-trim"` to TOOL_ROUTES.)
const TOOL_ROUTES = [
  "/tools/audio-convert",
  "/tools/docx-to-pdf",
  "/tools/docx-to-txt",
  "/tools/image-bg-remove",
  "/tools/image-convert",
  "/tools/image-resize",
  "/tools/image-to-pdf",
  "/tools/markdown-to-pdf",
  "/tools/pdf-edit",
  "/tools/pdf-merge",
  "/tools/pdf-split",
  "/tools/pdf-to-image",
  "/tools/pdf-to-md",
  "/tools/txt-to-pdf",
] as const;

const ALL_ROUTES = ["/", "/about", ...TOOL_ROUTES] as const;

const POLICY_CONSOLE_PATTERN = /coep|opener-policy|require-corp/i;

for (const route of ALL_ROUTES) {
  test(`${route} sets COOP same-origin and COEP require-corp`, async ({
    page,
  }) => {
    const response = await page.goto(route);
    expect(response, `no response for ${route}`).not.toBeNull();
    const headers = response?.headers() ?? {};
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(headers["cross-origin-embedder-policy"]).toBe("require-corp");
  });

  test(`${route} reports crossOriginIsolated === true in page context`, async ({
    page,
  }) => {
    await page.goto(route);
    const isolated = await page.evaluate(() => globalThis.crossOriginIsolated);
    expect(isolated).toBe(true);
  });

  test(`${route} produces no COEP/COOP console errors`, async ({ page }) => {
    const offending: string[] = [];
    page.on("console", (msg) => {
      if (POLICY_CONSOLE_PATTERN.test(msg.text())) {
        offending.push(`[${msg.type()}] ${msg.text()}`);
      }
    });
    page.on("pageerror", (err) => {
      if (POLICY_CONSOLE_PATTERN.test(err.message)) {
        offending.push(`[pageerror] ${err.message}`);
      }
    });
    await page.goto(route);
    // Settle network so any deferred font/script loads have a chance to log.
    await page.waitForLoadState("networkidle");
    expect(offending, `policy errors on ${route}`).toEqual([]);
  });
}

test("/tools/audio-convert fetches the MT ffmpeg worker file when isolated", async ({
  page,
  browserName,
}, testInfo) => {
  // Confirms the loader actually routed to /ffmpeg/mt/* (not silently to st/).
  // This catches the regression where COEP is set but the worker spawn-path
  // is wrong and the page silently degrades to single-threaded.
  //
  // Skipped on Firefox: Playwright's GeckoDriver does not surface nested-worker
  // network requests via page.on("request") / page.waitForRequest. The
  // conversion still runs correctly on Firefox (crossOriginIsolated is true
  // and the engine produces output), so the COOP/COEP wiring is verified by
  // the header + isolation + console-clean assertions above. This wiring check
  // is chromium + webkit only.
  test.skip(
    browserName === "firefox",
    "Playwright Firefox does not intercept nested-worker requests via page.on('request'); verified by isolation test and successful conversion output instead.",
  );
  testInfo.setTimeout(60_000);

  const fetched: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith("/ffmpeg/")) fetched.push(url.pathname);
  });

  await page.goto("/tools/audio-convert");
  await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");

  // Stage the WAV fixture (smallest of the four) and pick MP3 as output so
  // the engine actually loads ffmpeg.
  // Use locator('input[type="file"]') — the drop zone input has aria-label
  // "drop a file" (with "a"), so getByLabel(/drop file/i) does not match.
  const fixture = path.resolve(__dirname, "../fixtures/audio/sample.wav");
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await page.getByLabel(/^mp3/i).click();

  // Click Convert; we don't wait for transcode completion, only the early
  // worker fetch. Capture the request URL with a generous timeout.
  const workerReq = page.waitForRequest(
    (req) => req.url().endsWith("/ffmpeg/mt/ffmpeg-core.worker.js"),
    { timeout: 45_000 },
  );
  await page.getByTestId("convert-button").click();
  await workerReq;

  // Sanity: at least one mt/* asset should appear, and no st/* asset should.
  const mtFetches = fetched.filter((p) => p.startsWith("/ffmpeg/mt/"));
  const stFetches = fetched.filter((p) => p.startsWith("/ffmpeg/st/"));
  expect(mtFetches.length).toBeGreaterThan(0);
  expect(stFetches).toEqual([]);
});
