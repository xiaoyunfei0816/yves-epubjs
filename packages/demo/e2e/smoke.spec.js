import { expect, test } from "@playwright/test"

test("demo shell renders", async ({ page }) => {
  await page.goto("/")

  const diagnostics = page.locator(".reader-diagnostics")
  await expect(page.getByRole("heading", { name: "Open an EPUB and read it in the browser." })).toBeVisible()
  await expect(diagnostics.getByText("Chapter Diagnostics")).toBeVisible()
  await expect(diagnostics.getByText("Backend")).toBeVisible()
  await expect(diagnostics).toContainText("Mode")
  await expect(diagnostics).toContainText("Score")
  await expect(diagnostics).toContainText("No visible sections")
})
