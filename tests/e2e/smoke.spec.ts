import { expect, test } from "@playwright/test";

test("homepage responds with 200 and includes a body element", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("body")).toBeVisible();
});
