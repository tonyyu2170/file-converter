import { expect, test } from "@playwright/test";

test.describe("/tools/image-to-text", () => {
  test("page loads and renders the status indicator", async ({ page }) => {
    await page.goto("/tools/image-to-text");
    await expect(page.getByTestId("status-indicator")).toHaveText("[ READY ]");
  });

  test("file input is present and accepts image extensions", async ({ page }) => {
    await page.goto("/tools/image-to-text");
    const input = page.locator('input[type="file"]').first();
    await expect(input).toBeAttached();
    const accept = await input.getAttribute("accept");
    expect(accept ?? "").toMatch(/\.jpg/);
    expect(accept ?? "").toMatch(/\.png/);
    expect(accept ?? "").toMatch(/\.heic/);
  });

  test("output format select is visible with both options", async ({ page }) => {
    await page.goto("/tools/image-to-text");
    const select = page.getByTestId("output-format-select");
    await expect(select).toBeVisible();
    const options = await select.locator("option").allTextContents();
    expect(options).toHaveLength(2);
    // Closed enumeration — update both index assertions if outputFormat
    // gains a new variant.
    expect(options[0]).toMatch(/plain text/i);
    expect(options[1]).toMatch(/json/i);
  });

  test("convert button is disabled with no file staged", async ({ page }) => {
    await page.goto("/tools/image-to-text");
    await expect(page.getByTestId("convert-button")).toBeDisabled();
  });

  test("staging a file enables the convert button and format select stays functional", async ({
    page,
  }) => {
    await page.goto("/tools/image-to-text");

    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles("tests/fixtures/image-to-text/screenshot.png");

    // After a file is staged the convert button becomes enabled.
    await expect(page.getByTestId("convert-button")).toBeEnabled({ timeout: 5_000 });

    // Switching the format select should not crash the page.
    const select = page.getByTestId("output-format-select");
    await select.selectOption("json-with-bboxes");
    await expect(select).toHaveValue("json-with-bboxes");

    // Switch back — select remains functional.
    await select.selectOption("txt");
    await expect(select).toHaveValue("txt");
  });
});
