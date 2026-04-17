import type {
  Locator,
  Point,
  ReadingMode,
  Rect,
  SectionDocument
} from "../model/types"
import { findRenderedAnchorTarget } from "./navigation-target"

type DomLocatorViewportInput = {
  container: HTMLElement
  mode: ReadingMode
  sectionElement: HTMLElement
  locator: Locator
  sectionTop: number
  sectionHeight: number
}

type DomPointLocatorInput = {
  container: HTMLElement
  sectionElement: HTMLElement
  section: SectionDocument
  spineIndex: number
  point: Point
}

export function mapDomLocatorToViewport(input: DomLocatorViewportInput): Rect[] {
  const target =
    findRenderedAnchorTarget(input.sectionElement, input.locator.anchorId ?? "") ??
    findRenderedBlockTarget(input.sectionElement, input.locator.blockId)

  if (target) {
    return [measureElementRectWithinContainer(input.container, target, input.mode)]
  }

  return [
    createProgressRect({
      container: input.container,
      sectionElement: input.sectionElement,
      mode: input.mode,
      sectionTop: input.sectionTop,
      sectionHeight: input.sectionHeight,
      progressInSection: input.locator.progressInSection ?? 0
    })
  ]
}

export function mapDomPointToLocator(input: DomPointLocatorInput): Locator {
  const sectionRoot = getDomSectionRoot(input.sectionElement)
  const sectionHeight = getDomSectionHeight(input.sectionElement)
  const containerRect = input.container.getBoundingClientRect()
  const sectionRect = sectionRoot.getBoundingClientRect()
  const sectionTopInViewport = sectionRect.top - containerRect.top
  const clickY = input.point.y - sectionTopInViewport
  const progress = clampProgress(clickY / Math.max(1, sectionHeight))
  const target = findDomTargetContainingPoint({
    container: input.container,
    sectionElement: input.sectionElement,
    point: input.point
  })

  if (!target) {
    return {
      spineIndex: input.spineIndex,
      progressInSection: progress
    }
  }

  const anchorId = resolveAnchorIdForElement(input.section, target)
  const blockId = resolveBlockIdForElement(input.section, target, sectionRoot)

  return {
    spineIndex: input.spineIndex,
    progressInSection: progress,
    ...(anchorId ? { anchorId } : {}),
    ...(blockId ? { blockId } : {})
  }
}

function createProgressRect(input: {
  container: HTMLElement
  sectionElement: HTMLElement
  mode: ReadingMode
  sectionTop: number
  sectionHeight: number
  progressInSection: number
}): Rect {
  const sectionRoot = getDomSectionRoot(input.sectionElement)
  const containerRect = input.container.getBoundingClientRect()
  const sectionRect = sectionRoot.getBoundingClientRect()
  const progress = clampProgress(input.progressInSection)

  return {
    x: sectionRect.left - containerRect.left + input.container.scrollLeft,
    y:
      input.mode === "scroll"
        ? input.sectionTop + input.sectionHeight * progress
        : sectionRect.top - containerRect.top + input.sectionHeight * progress,
    width: Math.max(1, sectionRect.width),
    height: 1
  }
}

function findRenderedBlockTarget(
  sectionElement: HTMLElement,
  blockId: string | undefined
): HTMLElement | null {
  const normalizedBlockId = blockId?.trim()
  if (!normalizedBlockId) {
    return null
  }

  const selectorValue = escapeAttributeSelectorValue(normalizedBlockId)
  return (
    sectionElement.querySelector<HTMLElement>(`[id="${selectorValue}"]`) ??
    null
  )
}

function measureElementRectWithinContainer(
  container: HTMLElement,
  element: HTMLElement,
  mode: ReadingMode
): Rect {
  const containerRect = container.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()

  return {
    x: elementRect.left - containerRect.left + container.scrollLeft,
    y:
      mode === "scroll"
        ? elementRect.top - containerRect.top + container.scrollTop
        : elementRect.top - containerRect.top,
    width: elementRect.width,
    height: elementRect.height
  }
}

function findDomTargetContainingPoint(input: {
  container: HTMLElement
  sectionElement: HTMLElement
  point: Point
}): HTMLElement | null {
  const sectionRoot = getDomSectionRoot(input.sectionElement)
  const candidates = collectDomGeometryTargets(sectionRoot)
  if (candidates.length === 0) {
    return null
  }

  const containerRect = input.container.getBoundingClientRect()
  const pointX = input.point.x
  const pointY = input.point.y

  const matching = candidates.filter((candidate) => {
    const rect = candidate.getBoundingClientRect()
    const localRect = {
      left: rect.left - containerRect.left,
      right: rect.right - containerRect.left,
      top: rect.top - containerRect.top,
      bottom: rect.bottom - containerRect.top
    }

    return (
      pointX >= localRect.left &&
      pointX <= localRect.right &&
      pointY >= localRect.top &&
      pointY <= localRect.bottom
    )
  })

  if (matching.length === 0) {
    return null
  }

  matching.sort((left, right) => {
    const leftRect = left.getBoundingClientRect()
    const rightRect = right.getBoundingClientRect()
    const leftArea = leftRect.width * leftRect.height
    const rightArea = rightRect.width * rightRect.height
    return leftArea - rightArea
  })

  return matching[0] ?? null
}

function collectDomGeometryTargets(sectionRoot: HTMLElement): HTMLElement[] {
  const targets = sectionRoot.querySelectorAll<HTMLElement>("[id], a[name]")
  const elements = Array.from(targets)

  if (sectionRoot.id || sectionRoot.getAttribute("name")) {
    elements.unshift(sectionRoot)
  }

  return elements
}

function resolveAnchorIdForElement(
  section: SectionDocument,
  element: HTMLElement
): string | undefined {
  const elementId = element.id.trim()
  if (elementId && section.anchors[elementId]) {
    return elementId
  }

  const namedAnchor = element.getAttribute("name")?.trim()
  if (namedAnchor && section.anchors[namedAnchor]) {
    return namedAnchor
  }

  if (elementId) {
    const resolvedAnchor = Object.entries(section.anchors).find(
      ([, blockId]) => blockId === elementId
    )?.[0]
    if (resolvedAnchor) {
      return resolvedAnchor
    }
  }

  return undefined
}

function resolveBlockIdForElement(
  section: SectionDocument,
  element: HTMLElement,
  sectionRoot: HTMLElement
): string | undefined {
  const identifiedTarget = element.closest<HTMLElement>("[id]")
  const blockId = identifiedTarget?.id?.trim()
  if (blockId) {
    return blockId
  }

  const namedAnchor = element.getAttribute("name")?.trim()
  if (namedAnchor) {
    return section.anchors[namedAnchor]
  }

  if (sectionRoot.id.trim()) {
    return sectionRoot.id.trim()
  }

  return undefined
}

function getDomSectionRoot(sectionElement: HTMLElement): HTMLElement {
  return (
    sectionElement.querySelector<HTMLElement>(".epub-dom-section") ??
    sectionElement
  )
}

function getDomSectionHeight(sectionElement: HTMLElement): number {
  const sectionRoot = getDomSectionRoot(sectionElement)
  return Math.max(
    sectionRoot.scrollHeight || 0,
    sectionRoot.offsetHeight || 0,
    sectionElement.offsetHeight || 0,
    1
  )
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.min(value, 1))
}

function escapeAttributeSelectorValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')
}
