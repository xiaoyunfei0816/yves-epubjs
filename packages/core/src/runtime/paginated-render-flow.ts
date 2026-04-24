import type { Locator } from "../model/types"
import type { ReaderPage } from "./paginated-render-plan"
import type { RenderOutcome } from "./render-flow-types"

export function resolvePaginatedPageRenderOutcome(input: {
  page: ReaderPage
  locator: Locator | null
}): RenderOutcome {
  const progressInSection =
    input.page.totalPagesInSection > 1
      ? (input.page.pageNumberInSection - 1) /
        (input.page.totalPagesInSection - 1)
      : 0

  return {
    currentPageNumber: input.page.pageNumber,
    ...(input.locator
      ? {
          locator: {
            ...input.locator,
            spineIndex: input.page.spineIndex,
            progressInSection
          }
        }
      : {})
  }
}
