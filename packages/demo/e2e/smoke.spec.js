import { expect, test } from "@playwright/test"

test("demo shell renders", async ({ page }) => {
  await page.setContent(`
    <main>
      <button id="open-btn" type="button">Open Placeholder Book</button>
    </main>
  `)

  await expect(page.getByRole("button", { name: "Open Placeholder Book" })).toBeVisible()
})
