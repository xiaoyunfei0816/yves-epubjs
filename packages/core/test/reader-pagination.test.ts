import { describe, expect, it } from "vitest"
import type { ReaderPage } from "../src/runtime/paginated-render-plan"
import { resolveRenderedPage } from "../src/runtime/reader-pagination"

describe("reader pagination", () => {
  it("resolves the rendered page from the locator before a stale page number", () => {
    const pages = [
      createPage(1, 1, 0),
      createPage(2, 2, 320),
      createPage(3, 3, 640),
      createPage(4, 4, 960)
    ]

    const resolvedPage = resolveRenderedPage({
      pages,
      sectionId: "section-1",
      currentPageNumber: 4,
      pendingModeSwitchLocator: null,
      locator: {
        spineIndex: 0,
        progressInSection: 1 / 3
      }
    })

    expect(resolvedPage?.pageNumber).toBe(2)
  })
})

function createPage(
  pageNumber: number,
  pageNumberInSection: number,
  offsetInSection: number
): ReaderPage {
  return {
    pageNumber,
    pageNumberInSection,
    totalPagesInSection: 4,
    spineIndex: 0,
    sectionId: "section-1",
    sectionHref: "section-1.xhtml",
    offsetInSection,
    blocks: []
  }
}
