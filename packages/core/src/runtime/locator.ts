import type {
  Book,
  Locator,
  LocatorRestoreDiagnostics,
  LocatorPrecision,
  SectionDocument,
  SerializedLocator
} from "../model/types"
import { collectBlockIdsInReadingOrder } from "./reader-domain"

export function normalizeLocator(locator: Locator): Locator {
  const normalized: Locator = {
    spineIndex: normalizeSpineIndex(locator.spineIndex)
  }

  const blockId = normalizeOptionalString(locator.blockId)
  const anchorId = normalizeOptionalString(locator.anchorId)
  const cfi = normalizeOptionalString(locator.cfi)
  const inlineOffset = normalizeInlineOffset(locator.inlineOffset)
  const progressInSection = normalizeProgress(locator.progressInSection)

  if (blockId) {
    normalized.blockId = blockId
  }
  if (anchorId) {
    normalized.anchorId = anchorId
  }
  if (inlineOffset !== undefined) {
    normalized.inlineOffset = inlineOffset
  }
  if (cfi) {
    normalized.cfi = cfi
  }
  if (progressInSection !== undefined) {
    normalized.progressInSection = progressInSection
  }

  return normalized
}

export function serializeLocator(input: {
  locator: Locator
  book?: Book
  generateCfi?: boolean
}): SerializedLocator {
  const normalized = normalizeLocator(input.locator)
  const href = input.book?.sections[normalized.spineIndex]?.href
  const cfi =
    normalized.cfi ??
    (input.generateCfi && input.book && shouldGenerateSyntheticCfi(normalized)
      ? buildLocatorCfi({ book: input.book, locator: normalized })
      : undefined)

  return {
    ...normalized,
    ...(href ? { href } : {}),
    ...(cfi ? { cfi } : {})
  }
}

export function deserializeLocator(raw: unknown): SerializedLocator | null {
  const value = parseSerializedLocatorValue(raw)
  if (!value || typeof value !== "object") {
    return null
  }

  const next: SerializedLocator = {}

  if (isFiniteNumber(value.spineIndex)) {
    next.spineIndex = normalizeSpineIndex(value.spineIndex)
  }

  const href = normalizeOptionalString(value.href)
  const blockId = normalizeOptionalString(value.blockId)
  const anchorId = normalizeOptionalString(value.anchorId)
  const cfi = normalizeOptionalString(value.cfi)
  const inlineOffset = normalizeInlineOffset(value.inlineOffset)
  const progressInSection = normalizeProgress(value.progressInSection)

  if (href) {
    next.href = href
  }
  if (blockId) {
    next.blockId = blockId
  }
  if (anchorId) {
    next.anchorId = anchorId
  }
  if (inlineOffset !== undefined) {
    next.inlineOffset = inlineOffset
  }
  if (cfi) {
    next.cfi = cfi
  }
  if (progressInSection !== undefined) {
    next.progressInSection = progressInSection
  }

  return next.spineIndex === undefined && !next.href && !next.cfi ? null : next
}

export function restoreLocator(input: {
  book: Book
  locator: Locator | SerializedLocator
}): Locator | null {
  return restoreLocatorWithDiagnostics(input).locator
}

export function restoreLocatorWithDiagnostics(input: {
  book: Book
  locator: Locator | SerializedLocator
}): { locator: Locator | null; diagnostics: LocatorRestoreDiagnostics } {
  const serialized = isSerializedLocator(input.locator)
    ? input.locator
    : serializeLocator({ locator: input.locator, book: input.book })
  const requestedPrecision = getLocatorPrecision(serialized)
  const cfi = normalizeOptionalString(serialized.cfi)
  const parsedCfi = cfi ? parseLocatorCfi(cfi) : null
  const sectionMatch = resolveSectionMatch({
    book: input.book,
    locator: serialized,
    parsedCfi
  })
  const sectionIndex = sectionMatch.index
  if (sectionIndex < 0) {
    return {
      locator: null,
      diagnostics: {
        requestedPrecision,
        fallbackApplied: false,
        status: "failed",
        reason:
          requestedPrecision === "cfi" &&
          !hasResolvableHref(serialized) &&
          !isFiniteNumber(serialized.spineIndex)
            ? "invalid-locator"
            : "section-not-found",
        ...(sectionMatch.matchedBy ? { matchedBy: sectionMatch.matchedBy } : {})
      }
    }
  }

  const section = input.book.sections[sectionIndex]
  if (!section) {
    return {
      locator: null,
      diagnostics: {
        requestedPrecision,
        fallbackApplied: false,
        status: "failed",
        reason: "section-not-found",
        ...(sectionMatch.matchedBy ? { matchedBy: sectionMatch.matchedBy } : {})
      }
    }
  }

  const anchorId = normalizeOptionalString(serialized.anchorId)
  const blockId = normalizeOptionalString(serialized.blockId)
  const inlineOffset = normalizeInlineOffset(serialized.inlineOffset)
  const progressInSection = normalizeProgress(serialized.progressInSection)
  const resolvedInlineOffset = inlineOffset ?? parsedCfi?.inlineOffset

  const cfiTarget = parsedCfi ? resolveCfiTarget(section, parsedCfi) : null
  if (cfi && cfiTarget?.blockId) {
    const locator = normalizeLocator({
      spineIndex: sectionIndex,
      blockId: cfiTarget.blockId,
      ...(cfiTarget.anchorId ? { anchorId: cfiTarget.anchorId } : {}),
      ...(resolvedInlineOffset !== undefined ? { inlineOffset: resolvedInlineOffset } : {}),
      cfi,
      progressInSection: estimateSectionProgressForBlock(section, cfiTarget.blockId)
    })
    return {
      locator,
      diagnostics: {
        requestedPrecision,
        resolvedPrecision: "cfi",
        matchedBy: "cfi",
        fallbackApplied: false,
        status: "restored"
      }
    }
  }

  const anchorBlockId = anchorId ? findBlockIdForAnchor(section, anchorId) : undefined
  if (anchorBlockId) {
    const locator = normalizeLocator({
      spineIndex: sectionIndex,
      blockId: anchorBlockId,
      ...(anchorId ? { anchorId } : {}),
      ...(resolvedInlineOffset !== undefined ? { inlineOffset: resolvedInlineOffset } : {}),
      ...(cfi ? { cfi } : {}),
      progressInSection: estimateSectionProgressForBlock(section, anchorBlockId)
    })
    return {
      locator,
      diagnostics: {
        requestedPrecision,
        resolvedPrecision: anchorId && cfi ? "anchor" : getLocatorPrecision(locator),
        matchedBy: sectionMatch.matchedBy ?? (hasResolvableHref(serialized) ? "href" : "spineIndex"),
        fallbackApplied: requestedPrecision !== "anchor",
        status: "restored"
      }
    }
  }

  if (blockId && sectionHasBlockId(section, blockId)) {
    const locator = normalizeLocator({
      spineIndex: sectionIndex,
      blockId,
      ...(anchorId ? { anchorId } : {}),
      ...(resolvedInlineOffset !== undefined ? { inlineOffset: resolvedInlineOffset } : {}),
      ...(cfi ? { cfi } : {}),
      progressInSection: estimateSectionProgressForBlock(section, blockId)
    })
    return {
      locator,
      diagnostics: {
        requestedPrecision,
        resolvedPrecision: cfi ? "block" : getLocatorPrecision(locator),
        matchedBy: sectionMatch.matchedBy ?? (hasResolvableHref(serialized) ? "href" : "spineIndex"),
        fallbackApplied: requestedPrecision !== "block",
        status: "restored"
      }
    }
  }

  const locator = normalizeLocator({
    spineIndex: sectionIndex,
    ...(anchorId ? { anchorId } : {}),
    ...(resolvedInlineOffset !== undefined ? { inlineOffset: resolvedInlineOffset } : {}),
    ...(cfi ? { cfi } : {}),
    progressInSection: progressInSection ?? 0
  })
  const resolvedPrecision =
    progressInSection !== undefined || resolvedInlineOffset !== undefined ? "progress" : "section"
  return {
    locator,
    diagnostics: {
      requestedPrecision,
      resolvedPrecision,
      matchedBy: sectionMatch.matchedBy ?? (hasResolvableHref(serialized) ? "href" : "spineIndex"),
      fallbackApplied: requestedPrecision !== resolvedPrecision,
      status: "restored"
    }
  }
}

export function getLocatorPrecision(locator: Locator | SerializedLocator): LocatorPrecision {
  if (normalizeOptionalString(locator.cfi)) {
    return "cfi"
  }
  if (normalizeOptionalString(locator.anchorId)) {
    return "anchor"
  }
  if (normalizeOptionalString(locator.blockId)) {
    return "block"
  }
  if (normalizeProgress(locator.progressInSection) !== undefined) {
    return "progress"
  }
  return "section"
}

export function resolveSectionIndexForLocator(
  book: Book,
  locator: Locator | SerializedLocator
): number {
  return resolveSectionMatch({
    book,
    locator,
    parsedCfi: normalizeOptionalString(locator.cfi)
      ? parseLocatorCfi(normalizeOptionalString(locator.cfi)!)
      : null
  }).index
}

function resolveSectionMatch(input: {
  book: Book
  locator: Locator | SerializedLocator
  parsedCfi: ParsedLocatorCfi | null
}): { index: number; matchedBy?: "cfi" | "href" | "spineIndex" } {
  const cfiSectionIndex = resolveSectionIndexFromCfi(input.book, input.parsedCfi)
  if (cfiSectionIndex >= 0) {
    return {
      index: cfiSectionIndex,
      matchedBy: "cfi"
    }
  }

  const href = "href" in input.locator ? normalizeOptionalString(input.locator.href) : undefined
  if (href) {
    const normalizedTargetHref = normalizeBookHref(href)
    const hrefIndex = input.book.sections.findIndex((section) => {
      const normalizedSectionHref = normalizeBookHref(section.href)
      return (
        normalizedSectionHref === normalizedTargetHref ||
        normalizedTargetHref.endsWith(normalizedSectionHref) ||
        normalizedSectionHref.endsWith(normalizedTargetHref)
      )
    })
    if (hrefIndex >= 0) {
      return {
        index: hrefIndex,
        matchedBy: "href"
      }
    }
  }

  if (isFiniteNumber(input.locator.spineIndex)) {
    const normalizedIndex = normalizeSpineIndex(input.locator.spineIndex)
    return {
      index: normalizedIndex < input.book.sections.length ? normalizedIndex : -1,
      matchedBy: "spineIndex"
    }
  }

  return {
    index: -1
  }
}

export function findBlockIdForAnchor(
  section: SectionDocument,
  anchorId: string
): string | undefined {
  const normalizedAnchor = normalizeOptionalString(anchorId)
  if (!normalizedAnchor) {
    return undefined
  }

  return section.anchors[normalizedAnchor]
}

export function sectionHasBlockId(
  section: SectionDocument,
  blockId: string
): boolean {
  return collectBlockIdsInReadingOrder(section.blocks).includes(blockId)
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

function parseSerializedLocatorValue(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }

  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null
}

function isSerializedLocator(locator: Locator | SerializedLocator): locator is SerializedLocator {
  return "href" in locator || locator.spineIndex === undefined
}

function hasResolvableHref(locator: Locator | SerializedLocator): boolean {
  return "href" in locator && Boolean(normalizeOptionalString(locator.href))
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function normalizeInlineOffset(value: unknown): number | undefined {
  if (!isFiniteNumber(value)) {
    return undefined
  }

  return Math.max(0, Math.trunc(value))
}

function normalizeProgress(value: unknown): number | undefined {
  if (!isFiniteNumber(value)) {
    return undefined
  }

  return Math.max(0, Math.min(value, 1))
}

function normalizeSpineIndex(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.trunc(value))
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function normalizeBookHref(href: string): string {
  return href.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase()
}

function buildLocatorCfi(input: {
  book: Book
  locator: Locator
}): string | undefined {
  const section = input.book.sections[input.locator.spineIndex]
  if (!section) {
    return undefined
  }

  const blockIds = collectBlockIdsInReadingOrder(section.blocks)
  if (blockIds.length === 0) {
    return undefined
  }

  const target = resolveCfiGenerationTarget(section, blockIds, input.locator)
  if (!target) {
    return undefined
  }

  const spineStep = (input.locator.spineIndex + 1) * 2
  const blockStep = (target.blockIndex + 1) * 2
  const qualifier = target.qualifier ? `[${escapeCfiQualifier(target.qualifier)}]` : ""
  const offset =
    input.locator.inlineOffset !== undefined ? `:${Math.max(0, Math.trunc(input.locator.inlineOffset))}` : ""

  return `epubcfi(/6/${spineStep}!/${blockStep}${qualifier}${offset})`
}

function shouldGenerateSyntheticCfi(locator: Locator): boolean {
  return Boolean(locator.blockId || locator.anchorId)
}

function resolveCfiGenerationTarget(
  section: SectionDocument,
  blockIds: string[],
  locator: Locator
): { blockIndex: number; qualifier?: string } | null {
  const targetBlockId =
    locator.blockId && blockIds.includes(locator.blockId)
      ? locator.blockId
      : locator.anchorId
        ? findBlockIdForAnchor(section, locator.anchorId)
        : resolveBlockIdForProgress(section, locator.progressInSection)
  if (!targetBlockId) {
    return null
  }

  const blockIndex = blockIds.indexOf(targetBlockId)
  if (blockIndex < 0) {
    return null
  }

  const qualifier = resolvePreferredCfiQualifier(
    section,
    targetBlockId,
    locator.anchorId,
    locator.blockId
  )
  return {
    blockIndex,
    ...(qualifier ? { qualifier } : {})
  }
}

function resolvePreferredCfiQualifier(
  section: SectionDocument,
  blockId: string,
  explicitAnchorId?: string,
  explicitBlockId?: string
): string | undefined {
  const normalizedExplicitAnchorId = normalizeOptionalString(explicitAnchorId)
  if (normalizedExplicitAnchorId && section.anchors[normalizedExplicitAnchorId] === blockId) {
    return normalizedExplicitAnchorId
  }

  const normalizedExplicitBlockId = normalizeOptionalString(explicitBlockId)
  if (normalizedExplicitBlockId === blockId) {
    return blockId
  }

  const anchorId = Object.entries(section.anchors).find(([, targetBlockId]) => targetBlockId === blockId)?.[0]
  return anchorId ?? blockId
}

function resolveBlockIdForProgress(
  section: SectionDocument,
  progressInSection: number | undefined
): string | undefined {
  const normalizedProgress = normalizeProgress(progressInSection)
  const blockIds = collectBlockIdsInReadingOrder(section.blocks)
  if (normalizedProgress === undefined || blockIds.length === 0) {
    return undefined
  }

  const targetIndex = Math.max(0, Math.min(blockIds.length - 1, Math.round(normalizedProgress * (blockIds.length - 1))))
  return blockIds[targetIndex]
}

type ParsedLocatorCfi = {
  spineIndex?: number
  qualifierIds: string[]
  blockIndex?: number
  inlineOffset?: number
}

function parseLocatorCfi(cfi: string): ParsedLocatorCfi | null {
  const normalized = normalizeOptionalString(cfi)
  if (!normalized) {
    return null
  }

  const match = normalized.match(/^epubcfi\((.+)\)$/i)
  if (!match) {
    return null
  }

  const rawContent = match[1]?.trim()
  if (!rawContent) {
    return null
  }

  const [packagePart = "", rawContentPart = ""] = rawContent.split("!")
  const contentPart = rawContentPart.split(",")[0]?.trim() ?? ""
  const inlineOffsetMatch = contentPart.match(/:(\d+)$/)
  const pathWithoutOffset = inlineOffsetMatch ? contentPart.slice(0, -inlineOffsetMatch[0].length) : contentPart
  const packageSteps = extractCfiSteps(packagePart)
  const contentSteps = extractCfiSteps(pathWithoutOffset)
  const qualifierIds = Array.from(pathWithoutOffset.matchAll(/\[([^\]]+)\]/g))
    .map((entry) => entry[1]?.trim())
    .filter((value): value is string => Boolean(value))
  const lastEvenContentStep = [...contentSteps].reverse().find((step) => step % 2 === 0)

  return {
    ...(packageSteps.length > 0 ? { spineIndex: Math.max(0, Math.trunc(packageSteps[packageSteps.length - 1]! / 2) - 1) } : {}),
    qualifierIds,
    ...(typeof lastEvenContentStep === "number" ? { blockIndex: Math.max(0, Math.trunc(lastEvenContentStep / 2) - 1) } : {}),
    ...(inlineOffsetMatch ? { inlineOffset: Math.max(0, Number.parseInt(inlineOffsetMatch[1]!, 10) || 0) } : {})
  }
}

function resolveSectionIndexFromCfi(book: Book, parsedCfi: ParsedLocatorCfi | null): number {
  if (!parsedCfi || !isFiniteNumber(parsedCfi.spineIndex)) {
    return -1
  }

  const spineIndex = normalizeSpineIndex(parsedCfi.spineIndex)
  return spineIndex < book.sections.length ? spineIndex : -1
}

function resolveCfiTarget(
  section: SectionDocument,
  parsedCfi: ParsedLocatorCfi
): { blockId?: string; anchorId?: string } | null {
  for (let index = parsedCfi.qualifierIds.length - 1; index >= 0; index -= 1) {
    const qualifierId = normalizeOptionalString(parsedCfi.qualifierIds[index])
    if (!qualifierId) {
      continue
    }

    const anchorBlockId = findBlockIdForAnchor(section, qualifierId)
    if (anchorBlockId) {
      return {
        blockId: anchorBlockId,
        anchorId: qualifierId
      }
    }

    if (sectionHasBlockId(section, qualifierId)) {
      return {
        blockId: qualifierId
      }
    }
  }

  if (typeof parsedCfi.blockIndex === "number") {
    const blockId = collectBlockIdsInReadingOrder(section.blocks)[parsedCfi.blockIndex]
    if (blockId) {
      return {
        blockId
      }
    }
  }

  return null
}

function extractCfiSteps(path: string): number[] {
  return Array.from(path.matchAll(/\/(\d+)(?:\[[^\]]+\])?/g))
    .map((entry) => Number.parseInt(entry[1] ?? "", 10))
    .filter((value) => Number.isFinite(value))
}

function escapeCfiQualifier(value: string): string {
  return value.replace(/\[|\]/g, "")
}
