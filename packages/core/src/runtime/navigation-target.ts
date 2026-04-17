import type { BlockNode, Book, Locator, SectionDocument } from "../model/types"

export function createBlockLocator(input: {
  section: SectionDocument
  spineIndex: number
  blockId: string
  anchorId?: string
}): Locator {
  return {
    spineIndex: input.spineIndex,
    blockId: input.blockId,
    progressInSection: estimateSectionProgressForBlock(input.section, input.blockId),
    ...(input.anchorId ? { anchorId: input.anchorId } : {})
  }
}

export function resolveBookHrefLocator(input: {
  book: Book
  currentSectionIndex: number
  href: string
}): Locator | null {
  const [targetHref, targetAnchor] = splitHrefFragment(input.href)
  const targetIndex = targetHref.trim()
    ? input.book.sections.findIndex((section) => {
        const normalizedSectionHref = normalizeBookHref(section.href)
        const normalizedTargetHref = normalizeBookHref(targetHref)
        return (
          normalizedSectionHref === normalizedTargetHref ||
          normalizedTargetHref.endsWith(normalizedSectionHref) ||
          normalizedSectionHref.endsWith(normalizedTargetHref)
        )
      })
    : input.currentSectionIndex

  if (targetIndex < 0) {
    return null
  }

  const section = input.book.sections[targetIndex]
  if (!section) {
    return null
  }

  const blockId =
    targetAnchor ? section.anchors[targetAnchor] : undefined

  if (blockId) {
    return createBlockLocator({
      section,
      spineIndex: targetIndex,
      blockId,
      ...(targetAnchor ? { anchorId: targetAnchor } : {})
    })
  }

  return {
    spineIndex: targetIndex,
    progressInSection: 0,
    ...(targetAnchor ? { anchorId: targetAnchor } : {})
  }
}

export function findRenderedAnchorTarget(
  sectionElement: HTMLElement,
  anchorId: string
): HTMLElement | null {
  const normalizedAnchor = anchorId.trim()
  if (!normalizedAnchor) {
    return null
  }

  const selectorValue = escapeAttributeSelectorValue(normalizedAnchor)
  return (
    sectionElement.querySelector<HTMLElement>(`[id="${selectorValue}"]`) ??
    sectionElement.querySelector<HTMLElement>(`a[name="${selectorValue}"]`)
  )
}

export function estimateSectionProgressForBlock(
  section: SectionDocument,
  blockId: string
): number {
  const blockIds = collectBlockIdsInReadingOrder(section.blocks)
  const targetIndex = blockIds.indexOf(blockId)
  if (targetIndex < 0) {
    return 0
  }

  return blockIds.length > 1 ? targetIndex / (blockIds.length - 1) : 0
}

function splitHrefFragment(href: string): [string, string | null] {
  const [baseHref, fragment] = href.split("#", 2)
  return [baseHref ?? href, fragment ?? null]
}

function normalizeBookHref(href: string): string {
  return href.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase()
}

function escapeAttributeSelectorValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')
}

function collectBlockIdsInReadingOrder(blocks: BlockNode[]): string[] {
  const orderedIds: string[] = []

  for (const block of blocks) {
    orderedIds.push(block.id)
    switch (block.kind) {
      case "quote":
      case "figure":
      case "aside":
      case "nav":
        orderedIds.push(...collectBlockIdsInReadingOrder(block.blocks))
        break
      case "list":
        for (const item of block.items) {
          orderedIds.push(item.id)
          orderedIds.push(...collectBlockIdsInReadingOrder(item.blocks))
        }
        break
      case "table":
        if (block.caption) {
          orderedIds.push(...collectBlockIdsInReadingOrder(block.caption))
        }
        for (const row of block.rows) {
          orderedIds.push(row.id)
          for (const cell of row.cells) {
            orderedIds.push(cell.id)
            orderedIds.push(...collectBlockIdsInReadingOrder(cell.blocks))
          }
        }
        break
      case "definition-list":
        for (const item of block.items) {
          orderedIds.push(item.id)
          orderedIds.push(...collectBlockIdsInReadingOrder(item.term))
          for (const description of item.descriptions) {
            orderedIds.push(...collectBlockIdsInReadingOrder(description))
          }
        }
        break
      default:
        break
    }
  }

  return orderedIds
}
