import { expect, test } from "@playwright/test"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SMOKE_BOOK_PATH = path.resolve(
  __dirname,
  "../../../test-fixtures/books/minimal-book/book.epub"
)
const FXL_SPREAD_BOOK_PATH = path.resolve(
  __dirname,
  "../../../test-fixtures/books/fxl-spread-smoke/book.epub"
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

test("shows locator and restore diagnostics after bookmark restoration", async ({ page }) => {
  await page.goto("/")
  await openSmokeBook(page)

  const diagnostics = page.locator(".reader-diagnostics")
  await expect(diagnostics).toContainText("Locator")
  await expect(diagnostics).toContainText("s1 / progress:0.000")

  await page.getByRole("button", { name: "Save Bookmark" }).click()
  await page.getByRole("button", { name: "Chapter Two" }).click()
  await expect(page.locator(".reader-meta")).toContainText("Chapter Two")

  await page.getByRole("button", { name: "Restore Bookmark" }).click()

  await expect(page.locator(".reader-bookmark-status")).toContainText("Bookmark restored")
  await expect(page.locator(".reader-meta")).toContainText("Chapter One")
  await expect(diagnostics).toContainText("s1 / block:heading-1 / progress:0.000")
  await expect(diagnostics).toContainText("restored / cfi -> cfi")
  await expect(diagnostics).toContainText("cfi / fallback:no")
})

test("renders search and annotation overlays inside a synthetic spread", async ({ page }) => {
  await page.goto("/")
  await openBook(page, FXL_SPREAD_BOOK_PATH, "FXL Spread Smoke Book")
  await selectCustomOption(page, "Mode", "Paginated")

  await expect(page.locator(".reader-meta")).toContainText("FXL Spread Smoke Book")
  await expect(page.locator(".reader-root")).toHaveAttribute("data-synthetic-spread", "enabled")
  await expect(page.locator(".reader-diagnostics")).toContainText("auto / synthetic-on")

  await page.getByRole("searchbox").fill("Spread overlay target signal")
  await page.getByRole("button", { name: "Search" }).click()

  const searchResults = page.locator(".search-card")
  await expect(searchResults).toHaveCount(1)
  await expect(searchResults.first()).toContainText("page-3.xhtml")

  await searchResults.first().click()

  await expect(page.locator(".page-status")).toContainText("Page 2 / 2")
  await expect(page.locator(".reader-meta")).toContainText("Right Match")
  await expect(page.locator(".reader-viewport-overlay-rect.is-search-hit")).toHaveCount(1)

  await page.getByRole("button", { name: "Add Highlight" }).click()

  await expect(page.locator(".reader-highlight-status")).toContainText("Highlight saved")
  await expect(page.locator(".reader-viewport-overlay-rect.is-search-hit")).toHaveCount(1)
  await expect(page.locator(".reader-viewport-overlay-rect.is-annotation")).toHaveCount(1)

  const searchBox = await page.locator(".reader-viewport-overlay-rect.is-search-hit").boundingBox()
  const annotationBox = await page.locator(".reader-viewport-overlay-rect.is-annotation").boundingBox()

  expect(searchBox).not.toBeNull()
  expect(annotationBox).not.toBeNull()
  expect(Math.abs(annotationBox.x - searchBox.x)).toBeLessThan(8)
  expect(Math.abs(annotationBox.y - searchBox.y)).toBeLessThan(8)
})

async function openSmokeBook(page) {
  await openBook(page, SMOKE_BOOK_PATH, "Playwright Smoke Book")
}

async function openBook(page, bookPath, title) {
  await page.locator('input[type="file"]').setInputFiles(bookPath)

  await expect(page.locator(".reader-meta")).toContainText(title)
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
