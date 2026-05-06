import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const ROUTES = ["/", "/about", "/tools/pdf-merge", "/tools/image-convert", "/tools/pdf-edit"];

for (const route of ROUTES) {
  test(`a11y AA clean on ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState("networkidle");

    // For /about, the engines table loads asynchronously — wait for it to render.
    if (route === "/about") {
      await expect(page.getByRole("table")).toBeVisible({ timeout: 10_000 });
    }

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    if (results.violations.length > 0) {
      const summary = results.violations
        .map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s)`)
        .join("\n");
      console.error(`a11y violations on ${route}:\n${summary}`);
    }

    expect(results.violations).toEqual([]);
  });
}
