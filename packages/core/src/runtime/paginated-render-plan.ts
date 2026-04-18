import type {
  LayoutBlock,
  LayoutPretextBlock,
  LayoutResult
} from "../layout/layout-engine"
import type {
  BlockNode,
  Locator,
  SectionDocument,
  Theme,
  TypographyOptions
} from "../model/types"
import { normalizeLocator } from "./locator"
import type { SectionDisplayList } from "../renderer/draw-ops"

export type PageBlockSlice =
  | {
      type: "pretext"
      block: LayoutPretextBlock
      lineStart: number
      lineEnd: number
    }
  | {
      type: "native"
      block: BlockNode
    }

export type ReaderPage = {
  pageNumber: number
  pageNumberInSection: number
  totalPagesInSection: number
  spineIndex: number
  sectionId: string
  sectionHref: string
  blocks: PageBlockSlice[]
}

export function buildPaginatedPages(options: {
  sections: SectionDocument[]
  currentSectionIndex: number
  sectionLayout: LayoutResult | undefined
  pageHeight: number
  getSectionLayout: (section: SectionDocument, sectionIndex: number) => LayoutResult
}): {
  pages: ReaderPage[]
  sectionEstimatedHeights: number[]
} {
  const pages: ReaderPage[] = []
  let pageNumber = 1

  for (let index = 0; index < options.sections.length; index += 1) {
    const section = options.sections[index]
    if (!section) {
      continue
    }

    const layout =
      options.sectionLayout && index === options.currentSectionIndex
        ? options.sectionLayout
        : options.getSectionLayout(section, index)

    let currentPage: ReaderPage = {
      pageNumber,
      pageNumberInSection: 1,
      totalPagesInSection: 1,
      spineIndex: index,
      sectionId: section.id,
      sectionHref: section.href,
      blocks: []
    }
    let usedHeight = 0

    if (section.renditionLayout === "pre-paginated") {
      pages.push(currentPage)
      pageNumber += 1
      continue
    }

    for (const layoutBlock of layout.blocks) {
      if (layoutBlock.type === "pretext") {
        let lineStart = 0
        while (lineStart < layoutBlock.lines.length) {
          const remainingHeight = options.pageHeight - usedHeight
          let lineEnd = findPretextLineBreak(
            layoutBlock.lines,
            lineStart,
            remainingHeight
          )

          if (lineEnd === lineStart && currentPage.blocks.length > 0) {
            pages.push(currentPage)
            pageNumber += 1
            currentPage = {
              pageNumber,
              pageNumberInSection: currentPage.pageNumberInSection + 1,
              totalPagesInSection: 1,
              spineIndex: index,
              sectionId: section.id,
              sectionHref: section.href,
              blocks: []
            }
            usedHeight = 0
            lineEnd = findPretextLineBreak(
              layoutBlock.lines,
              lineStart,
              options.pageHeight
            )
          }

          if (lineEnd === lineStart) {
            lineEnd = Math.min(layoutBlock.lines.length, lineStart + 1)
          }

          currentPage.blocks.push({
            type: "pretext",
            block: layoutBlock,
            lineStart,
            lineEnd
          })
          usedHeight += sumPretextLineHeights(layoutBlock.lines, lineStart, lineEnd)
          lineStart = lineEnd

          if (lineStart < layoutBlock.lines.length) {
            pages.push(currentPage)
            pageNumber += 1
            currentPage = {
              pageNumber,
              pageNumberInSection: currentPage.pageNumberInSection + 1,
              totalPagesInSection: 1,
              spineIndex: index,
              sectionId: section.id,
              sectionHref: section.href,
              blocks: []
            }
            usedHeight = 0
          }
        }

        usedHeight += getPretextBlockTrailingSpace(layoutBlock)
        continue
      }

      if (
        currentPage.blocks.length > 0 &&
        usedHeight + layoutBlock.estimatedHeight > options.pageHeight
      ) {
        pages.push(currentPage)
        pageNumber += 1
        currentPage = {
          pageNumber,
          pageNumberInSection: currentPage.pageNumberInSection + 1,
          totalPagesInSection: 1,
          spineIndex: index,
          sectionId: section.id,
          sectionHref: section.href,
          blocks: []
        }
        usedHeight = 0
      }

      currentPage.blocks.push({
        type: "native",
        block: layoutBlock.block
      })
      usedHeight += layoutBlock.estimatedHeight
    }

    if (currentPage.blocks.length > 0 || pages.length === 0) {
      pages.push(currentPage)
      pageNumber += 1
    }
  }

  const totalPagesBySection = new Map<string, number>()
  for (const page of pages) {
    totalPagesBySection.set(
      page.sectionId,
      (totalPagesBySection.get(page.sectionId) ?? 0) + 1
    )
  }

  return {
    pages: pages.map((page, index) => ({
      ...page,
      pageNumber: index + 1,
      totalPagesInSection: totalPagesBySection.get(page.sectionId) ?? 1
    })),
    sectionEstimatedHeights: options.sections.map((section) => {
      const sectionPageCount = totalPagesBySection.get(section.id) ?? 1
      return Math.max(options.pageHeight, sectionPageCount * options.pageHeight)
    })
  }
}

export function buildPageDisplayList(options: {
  page: ReaderPage
  section: SectionDocument
  width: number
  viewportHeight: number
  theme: Theme
  typography: TypographyOptions
  highlightedBlockIds: Set<string>
  highlightRangesByBlock?: Map<string, Array<{ start: number; end: number; color: string }>>
  underlinedBlockIds: Set<string>
  activeBlockId: string | undefined
  resolveImageLoaded: (src: string) => boolean
  resolveImageUrl: (src: string) => string
  estimateBlockHeight: (block: BlockNode) => number
  buildSectionDisplayList: (input: {
    section: SectionDocument
    width: number
    viewportHeight: number
    blocks: LayoutBlock[]
    theme: Theme
    typography: TypographyOptions
    locatorMap: Map<string, Locator>
    highlightedBlockIds: Set<string>
    highlightRangesByBlock?: Map<string, Array<{ start: number; end: number; color: string }>>
    underlinedBlockIds: Set<string>
    activeBlockId: string | undefined
    resolveImageLoaded: (src: string) => boolean
    resolveImageUrl: (src: string) => string
  }) => SectionDisplayList
}): SectionDisplayList {
  const blocks = options.page.blocks.map((slice) =>
    slice.type === "pretext"
      ? ({
          ...slice.block,
          lines: slice.block.lines.slice(slice.lineStart, slice.lineEnd),
          estimatedHeight:
            sumPretextLineHeights(slice.block.lines, slice.lineStart, slice.lineEnd) +
            (slice.lineEnd === slice.block.lines.length
              ? getPretextBlockTrailingSpace(slice.block)
              : 0)
        } satisfies LayoutPretextBlock)
      : ({
          type: "native",
          id: slice.block.id,
          block: slice.block,
          estimatedHeight: options.estimateBlockHeight(slice.block)
        } satisfies LayoutBlock)
  ) as LayoutBlock[]

  const locatorMap = new Map<string, Locator>()
  for (const block of blocks) {
    locatorMap.set(
      block.id,
      normalizeLocator({
        spineIndex: options.page.spineIndex,
        blockId: block.id,
        progressInSection:
          options.page.totalPagesInSection > 1
            ? (options.page.pageNumberInSection - 1) /
              (options.page.totalPagesInSection - 1)
            : 0
      })
    )
  }

  return options.buildSectionDisplayList({
    section: options.section,
    width: options.width,
    viewportHeight: options.viewportHeight,
    blocks,
    theme: options.theme,
    typography: options.typography,
    locatorMap,
    highlightedBlockIds: options.highlightedBlockIds,
    ...(options.highlightRangesByBlock ? { highlightRangesByBlock: options.highlightRangesByBlock } : {}),
    underlinedBlockIds: options.underlinedBlockIds,
    activeBlockId: options.activeBlockId,
    resolveImageLoaded: options.resolveImageLoaded,
    resolveImageUrl: options.resolveImageUrl
  })
}

function sumPretextLineHeights(
  lines: Array<{ height: number }>,
  start = 0,
  end = lines.length
): number {
  let total = 0
  for (let index = start; index < end; index += 1) {
    total += lines[index]?.height ?? 0
  }
  return total
}

function getPretextBlockTrailingSpace(block: LayoutPretextBlock): number {
  return Math.max(
    0,
    block.estimatedHeight - sumPretextLineHeights(block.lines)
  )
}

function findPretextLineBreak(
  lines: Array<{ height: number }>,
  start: number,
  availableHeight: number
): number {
  if (availableHeight <= 0) {
    return start
  }

  let totalHeight = 0
  let index = start
  while (index < lines.length) {
    const lineHeight = lines[index]?.height ?? 0
    if (totalHeight > 0 && totalHeight + lineHeight > availableHeight) {
      break
    }
    totalHeight += lineHeight
    index += 1
    if (totalHeight >= availableHeight) {
      break
    }
  }

  return index
}
