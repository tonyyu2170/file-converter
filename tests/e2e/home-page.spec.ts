import { expect, test } from "@playwright/test";

const TOOLS = [
  { id: "image-convert", href: "/tools/image-convert" },
  { id: "image-to-pdf", href: "/tools/image-to-pdf" },
  { id: "pdf-merge", href: "/tools/pdf-merge" },
  { id: "pdf-split", href: "/tools/pdf-split" },
] as const;

test("home page renders hero headline", async ({ page }) => {
  await page.goto("/");
  const headline = page.getByTestId("hero-headline");
  await expect(headline).toBeVisible();
  await expect(headline).toContainText("convert files");
  await expect(headline).toContainText("uploading");
});

for (const tool of TOOLS) {
  test(`tool card ${tool.id} navigates to ${tool.href}`, async ({ page }) => {
    await page.goto("/");
    await page.getByTestId(`tool-card-${tool.id}`).click();
    await page.waitForURL(`**${tool.href}`);
    expect(new URL(page.url()).pathname).toBe(tool.href);
  });
}
