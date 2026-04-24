import type { Locator } from "./types"

export function normalizeLocator(locator: Locator): Locator {
  const normalized: Locator = {
    spineIndex: normalizeLocatorSpineIndex(locator.spineIndex)
  }

  const blockId = normalizeOptionalLocatorString(locator.blockId)
  const anchorId = normalizeOptionalLocatorString(locator.anchorId)
  const cfi = normalizeOptionalLocatorString(locator.cfi)
  const inlineOffset = normalizeLocatorInlineOffset(locator.inlineOffset)
  const progressInSection = normalizeLocatorProgress(locator.progressInSection)

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

export function normalizeOptionalLocatorString(
  value: unknown
): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function normalizeLocatorInlineOffset(
  value: unknown
): number | undefined {
  if (!isFiniteLocatorNumber(value)) {
    return undefined
  }

  return Math.max(0, Math.trunc(value))
}

export function normalizeLocatorProgress(value: unknown): number | undefined {
  if (!isFiniteLocatorNumber(value)) {
    return undefined
  }

  return Math.max(0, Math.min(value, 1))
}

export function normalizeLocatorSpineIndex(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.trunc(value))
}

export function isFiniteLocatorNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}
