import { nanoid } from "nanoid"
import type { Annotation, Book, Decoration, Locator, SerializedLocator } from "../model/types"
import { deserializeLocator, serializeLocator } from "./locator"

export function createAnnotation(input: {
  publicationId: string
  locator: Locator
  book?: Book
  quote?: string
  note?: string
  color?: string
  createdAt?: string
  updatedAt?: string
}): Annotation {
  const timestamp = input.createdAt ?? new Date().toISOString()

  return {
    id: nanoid(),
    publicationId: input.publicationId,
    locator: serializeLocator({
      locator: input.locator,
      generateCfi: true,
      ...(input.book ? { book: input.book } : {})
    }),
    createdAt: timestamp,
    updatedAt: input.updatedAt ?? timestamp,
    ...(input.quote?.trim() ? { quote: input.quote.trim() } : {}),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    ...(input.color?.trim() ? { color: input.color.trim() } : {})
  }
}

export function serializeAnnotation(annotation: Annotation): string {
  return JSON.stringify(annotation)
}

export function deserializeAnnotation(raw: unknown): Annotation | null {
  const value = parseAnnotationValue(raw)
  if (!value || typeof value !== "object") {
    return null
  }

  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : null
  const publicationId =
    typeof value.publicationId === "string" && value.publicationId.trim()
      ? value.publicationId.trim()
      : null
  const createdAt =
    typeof value.createdAt === "string" && value.createdAt.trim() ? value.createdAt.trim() : null
  const updatedAt =
    typeof value.updatedAt === "string" && value.updatedAt.trim() ? value.updatedAt.trim() : null
  const locator = deserializeLocator(value.locator)

  if (!id || !publicationId || !createdAt || !updatedAt || !locator) {
    return null
  }

  return {
    id,
    publicationId,
    locator,
    createdAt,
    updatedAt,
    ...(typeof value.quote === "string" && value.quote.trim() ? { quote: value.quote.trim() } : {}),
    ...(typeof value.note === "string" && value.note.trim() ? { note: value.note.trim() } : {}),
    ...(typeof value.color === "string" && value.color.trim() ? { color: value.color.trim() } : {})
  }
}

export function mapAnnotationToDecoration(annotation: Annotation): Decoration {
  return {
    id: `annotation:${annotation.id}`,
    group: "annotations",
    locator: {
      ...(annotation.locator.spineIndex !== undefined
        ? { spineIndex: annotation.locator.spineIndex }
        : { spineIndex: 0 }),
      ...(annotation.locator.blockId ? { blockId: annotation.locator.blockId } : {}),
      ...(annotation.locator.anchorId ? { anchorId: annotation.locator.anchorId } : {}),
      ...(annotation.locator.inlineOffset !== undefined
        ? { inlineOffset: annotation.locator.inlineOffset }
        : {}),
      ...(annotation.locator.cfi ? { cfi: annotation.locator.cfi } : {}),
      ...(annotation.locator.progressInSection !== undefined
        ? { progressInSection: annotation.locator.progressInSection }
        : {})
    },
    style: "highlight",
    ...(annotation.color ? { color: annotation.color } : {})
  }
}

export function mapAnnotationsToDecorations(annotations: Annotation[]): Decoration[] {
  return annotations.map(mapAnnotationToDecoration)
}

function parseAnnotationValue(raw: unknown): Record<string, unknown> | null {
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

export type { SerializedLocator }
