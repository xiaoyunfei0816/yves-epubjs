import type { Book, Locator, Point } from "../model/types"
import { createBlockLocator } from "./navigation-target"
import { normalizeLocator } from "./locator"

export function mapCanvasTextLayerClientPointToLocator(input: {
  container: HTMLElement
  book: Book
  clientPoint: Point
  getSectionIndexById: (sectionId?: string | null) => number
}): Locator | null {
  const ownerDocument = input.container.ownerDocument ?? document
  if (typeof ownerDocument.elementFromPoint !== "function") {
    return null
  }

  const pointTarget = ownerDocument.elementFromPoint(
    input.clientPoint.x,
    input.clientPoint.y
  )
  const textRun =
    resolveCanvasTextRunFromTarget(pointTarget) ??
    findNearestCanvasTextRun({
      container: input.container,
      clientPoint: input.clientPoint
    })
  if (!textRun) {
    return null
  }

  return createLocatorFromCanvasTextRun({
    book: input.book,
    textRun,
    clientPoint: input.clientPoint,
    getSectionIndexById: input.getSectionIndexById
  })
}

export function resolveCanvasTextRunFromTarget(
  target: Element | null
): HTMLElement | null {
  return target instanceof HTMLElement
    ? target.closest<HTMLElement>(".epub-text-run")
    : null
}

export function findNearestCanvasTextRun(input: {
  container: HTMLElement
  clientPoint: Point
}): HTMLElement | null {
  const containerRect = input.container.getBoundingClientRect()
  const maxDistance = Math.max(80, input.container.clientHeight * 0.2)
  let nearest: { element: HTMLElement; distance: number } | null = null
  for (const element of Array.from(
    input.container.querySelectorAll<HTMLElement>(".epub-text-run")
  )) {
    const rect = element.getBoundingClientRect()
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.bottom < containerRect.top ||
      rect.top > containerRect.bottom ||
      rect.right < containerRect.left ||
      rect.left > containerRect.right
    ) {
      continue
    }

    const dx =
      input.clientPoint.x < rect.left
        ? rect.left - input.clientPoint.x
        : input.clientPoint.x > rect.right
          ? input.clientPoint.x - rect.right
          : 0
    const dy =
      input.clientPoint.y < rect.top
        ? rect.top - input.clientPoint.y
        : input.clientPoint.y > rect.bottom
          ? input.clientPoint.y - rect.bottom
          : 0
    const distance = Math.hypot(dx, dy)
    if (distance <= maxDistance && (!nearest || distance < nearest.distance)) {
      nearest = { element, distance }
    }
  }

  return nearest?.element ?? null
}

export function createLocatorFromCanvasTextRun(input: {
  book: Book
  textRun: HTMLElement
  clientPoint: Point
  getSectionIndexById: (sectionId?: string | null) => number
}): Locator | null {
  const sectionId = input.textRun.dataset.readerSectionId?.trim()
  const blockId = input.textRun.dataset.readerBlockId?.trim()
  const sectionIndex = sectionId ? input.getSectionIndexById(sectionId) : -1
  const section = sectionIndex >= 0 ? input.book.sections[sectionIndex] : null
  if (!sectionId || !section || !blockId) {
    return null
  }

  const inlineStart =
    Number.parseInt(input.textRun.dataset.readerInlineStart ?? "0", 10) || 0
  const fallbackTextLength = Array.from(input.textRun.textContent ?? "").length
  const inlineEnd =
    Number.parseInt(
      input.textRun.dataset.readerInlineEnd ??
        `${inlineStart + fallbackTextLength}`,
      10
    ) || inlineStart + fallbackTextLength
  const absoluteInlineOffset = resolveInlineOffsetAtClientPoint({
    textRun: input.textRun,
    clientX: input.clientPoint.x,
    clientY: input.clientPoint.y,
    inlineStart,
    inlineEnd
  })

  return normalizeLocator({
    ...createBlockLocator({
      section,
      spineIndex: sectionIndex,
      blockId
    }),
    inlineOffset: absoluteInlineOffset
  })
}

export function resolveCanvasTextPosition(input: {
  container: HTMLElement
  sectionId: string
  blockId: string
  inlineOffset: number
  bias: "start" | "end"
}): { node: Text; offset: number } | null {
  const selectorValue = escapeAttributeSelectorValue(input.blockId)
  const runs = Array.from(
    input.container.querySelectorAll<HTMLElement>(
      `.epub-text-run[data-reader-section-id="${escapeAttributeSelectorValue(
        input.sectionId
      )}"][data-reader-block-id="${selectorValue}"]`
    )
  )
  if (runs.length === 0) {
    return null
  }

  const clampedOffset = Math.max(0, Math.trunc(input.inlineOffset))
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index]
    if (!run) {
      continue
    }

    const runStart =
      Number.parseInt(run.dataset.readerInlineStart ?? "0", 10) || 0
    const fallbackTextLength = Array.from(run.textContent ?? "").length
    const runEnd =
      Number.parseInt(
        run.dataset.readerInlineEnd ?? `${runStart + fallbackTextLength}`,
        10
      ) || runStart + fallbackTextLength
    const isBoundary = clampedOffset === runEnd
    const matches =
      clampedOffset < runEnd ||
      (clampedOffset === runStart && input.bias === "start") ||
      (isBoundary && (input.bias === "end" || index === runs.length - 1))
    if (!matches) {
      continue
    }

    const textNode = run.firstChild
    if (!(textNode instanceof Text)) {
      return null
    }

    const localOffset =
      input.bias === "end" && clampedOffset >= runEnd
        ? (textNode.textContent?.length ?? 0)
        : Math.max(
            0,
            Math.min(
              textNode.textContent?.length ?? 0,
              clampedOffset - runStart
            )
          )
    return {
      node: textNode,
      offset: localOffset
    }
  }

  const lastRun = runs.at(-1)
  const textNode = lastRun?.firstChild
  return textNode instanceof Text
    ? {
        node: textNode,
        offset: textNode.textContent?.length ?? 0
      }
    : null
}

function resolveInlineOffsetAtClientPoint(input: {
  textRun: HTMLElement
  clientX: number
  clientY: number
  inlineStart: number
  inlineEnd: number
}): number {
  const textLength = Array.from(input.textRun.textContent ?? "").length
  const maxOffset = Math.max(input.inlineStart, input.inlineEnd)
  const minOffset = Math.min(input.inlineStart, input.inlineEnd)
  if (textLength <= 0 || maxOffset <= minOffset) {
    return minOffset
  }

  const localOffset = resolveLocalTextOffsetAtClientPoint({
    textRun: input.textRun,
    clientX: input.clientX,
    clientY: input.clientY,
    textLength
  })
  const maxReadableInlineOffset = Math.max(
    input.inlineStart,
    input.inlineEnd - 1
  )
  return Math.max(
    input.inlineStart,
    Math.min(maxReadableInlineOffset, input.inlineStart + localOffset)
  )
}

function resolveLocalTextOffsetAtClientPoint(input: {
  textRun: HTMLElement
  clientX: number
  clientY: number
  textLength: number
}): number {
  const documentWithCaret = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number
    ) => { offsetNode: Node | null; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const firstTextNode = input.textRun.firstChild

  const caretPosition = documentWithCaret.caretPositionFromPoint?.(
    input.clientX,
    input.clientY
  )
  if (
    caretPosition?.offsetNode &&
    input.textRun.contains(caretPosition.offsetNode)
  ) {
    return Math.max(0, Math.min(input.textLength, caretPosition.offset))
  }

  const caretRange = documentWithCaret.caretRangeFromPoint?.(
    input.clientX,
    input.clientY
  )
  if (
    caretRange?.startContainer &&
    input.textRun.contains(caretRange.startContainer)
  ) {
    return Math.max(0, Math.min(input.textLength, caretRange.startOffset))
  }

  if (!(firstTextNode instanceof Text)) {
    return 0
  }

  const rect = input.textRun.getBoundingClientRect()
  if (rect.width <= 0) {
    return 0
  }

  const ratio = Math.max(
    0,
    Math.min(1, (input.clientX - rect.left) / rect.width)
  )
  return Math.max(
    0,
    Math.min(input.textLength, Math.round(ratio * input.textLength))
  )
}

function escapeAttributeSelectorValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')
}
