import { expect, test } from "@playwright/test";

test("/about renders the privacy claim and engines table", async ({ page }) => {
  await page.goto("/about");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    /files\s*never\s*leave\s*your\s*device/i,
  );
  // All five visible section headings.
  for (const heading of [
    "why this exists",
    "verify it yourself",
    "how it works",
    "engines",
    "source",
  ]) {
    await expect(page.locator(`h2:has-text("${heading}")`)).toBeVisible();
  }
  // Engines table populates with at least one row.
  const table = page.getByTestId("engines-table");
  await expect(table).toBeVisible({ timeout: 10_000 });
  await expect(table.locator("tbody tr")).not.toHaveCount(0);
  // Source link points at a github URL.
  const sourceLink = page.locator('a[href^="https://github.com/"]').first();
  await expect(sourceLink).toBeVisible();
});

test("/about reachable from layout footer", async ({ page }) => {
  await page.goto("/");
  await page.locator('footer a[href="/about"]').click();
  await page.waitForURL(/\/about$/);
  await expect(page).toHaveURL(/\/about$/);
});
