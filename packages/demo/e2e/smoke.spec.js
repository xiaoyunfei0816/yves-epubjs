import { expect, test } from "@playwright/test"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SMOKE_BOOK_PATH = path.resolve(
  __dirname,
  "../../../test-fixtures/books/minimal-book/book.epub"
)

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

test("opens an epub and navigates with toc and search", async ({ page }) => {
  await page.goto("/")
  await openSmokeBook(page)

  await expect(page.locator(".reader-meta")).toContainText("Playwright Smoke Book")
  await expect(page.locator(".sidebar-panel")).toContainText("Chapter One")
  await expect(page.locator(".sidebar-panel")).toContainText("Chapter Two")

  await page.getByRole("button", { name: "Chapter Two" }).click()
  await expect(page.locator(".reader-meta")).toContainText("Chapter Two")

  await page.getByRole("searchbox").fill("beta-keyword")
  await page.getByRole("button", { name: "Search" }).click()

  const searchResults = page.locator(".search-card")
  await expect(searchResults.first()).toContainText("chapter-2.xhtml")
  await page.getByRole("button", { name: "Chapter One" }).click()
  await expect(page.locator(".reader-meta")).toContainText("Chapter One")
  await searchResults.first().click()
  await expect(page.locator(".reader-meta")).toContainText("Chapter Two")
})

test("supports paginated next and previous navigation", async ({ page }) => {
  await page.goto("/")
  await openSmokeBook(page)

  await selectCustomOption(page, "Mode", "Paginated")

  const pageStatus = page.locator(".page-status")
  await expect(pageStatus).toContainText("Page 1 /")
  await expect.poll(async () => parseTotalPages(await pageStatus.textContent())).toBeGreaterThan(1)

  await page.getByRole("button", { name: "Next" }).click()
  await expect(pageStatus).toContainText("Page 2 /")

  await page.getByRole("button", { name: "Previous" }).click()
  await expect(pageStatus).toContainText("Page 1 /")
})

async function openSmokeBook(page) {
  await page.locator('input[type="file"]').setInputFiles(SMOKE_BOOK_PATH)

  await expect(page.locator(".reader-meta")).toContainText("Playwright Smoke Book")
}

async function selectCustomOption(page, label, option) {
  const field = page.locator(".field-shell").filter({ hasText: label })
  await field.getByRole("button").click()
  await page.getByRole("option", { name: option }).click()
}

function parseTotalPages(text) {
  const match = text?.match(/Page\s+\d+\s*\/\s*(\d+)/)
  return match ? Number(match[1]) : 0
}
