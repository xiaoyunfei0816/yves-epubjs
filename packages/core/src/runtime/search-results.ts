import type { BlockNode, SearchResult, SectionDocument } from "../model/types"
import { extractBlockText } from "../utils/block-text"
import { createBlockLocator } from "./navigation-target"

export function buildSearchResultsForSection(input: {
  section: SectionDocument
  spineIndex: number
  query: string
}): SearchResult[] {
  const queryText = input.query.trim()
  const normalizedQuery = normalizeSearchText(queryText)
  if (!normalizedQuery) {
    return []
  }

  return input.section.blocks.flatMap((block) =>
    collectSearchResultsForBlock({
      section: input.section,
      spineIndex: input.spineIndex,
      block,
      queryText,
      normalizedQuery
    })
  )
}

function collectSearchResultsForBlock(input: {
  section: SectionDocument
  spineIndex: number
  block: BlockNode
  queryText: string
  normalizedQuery: string
}): SearchResult[] {
  const nestedResults = collectNestedBlockNodes(input.block).flatMap((block) =>
    collectSearchResultsForBlock({
      ...input,
      block
    })
  )
  if (nestedResults.length > 0) {
    return nestedResults
  }

  const text = normalizeExcerptText(extractBlockText(input.block))
  if (!text || !normalizeSearchText(text).includes(input.normalizedQuery)) {
    return []
  }

  return [
    {
      sectionId: input.section.id,
      href: input.section.href,
      excerpt: createSearchExcerpt(text, input.normalizedQuery),
      matchText: input.queryText,
      locator: createBlockLocator({
        section: input.section,
        spineIndex: input.spineIndex,
        blockId: input.block.id
      })
    }
  ]
}

function collectNestedBlockNodes(block: BlockNode): BlockNode[] {
  switch (block.kind) {
    case "quote":
    case "aside":
    case "nav":
      return block.blocks
    case "figure":
      return [...block.blocks, ...(block.caption ?? [])]
    case "list":
      return block.items.flatMap((item) => item.blocks)
    case "table":
      return [
        ...(block.caption ?? []),
        ...block.rows.flatMap((row) => row.cells.flatMap((cell) => cell.blocks))
      ]
    case "definition-list":
      return block.items.flatMap((item) => [
        ...item.term,
        ...item.descriptions.flatMap((description) => description)
      ])
    default:
      return []
  }
}

function createSearchExcerpt(text: string, normalizedQuery: string): string {
  if (text.length <= 160) {
    return text
  }

  const normalizedText = normalizeSearchText(text)
  const matchIndex = normalizedText.indexOf(normalizedQuery)
  if (matchIndex < 0) {
    return text.slice(0, 157).trimEnd() + "..."
  }

  const start = Math.max(0, matchIndex - 60)
  const end = Math.min(text.length, matchIndex + normalizedQuery.length + 60)
  const prefix = start > 0 ? "..." : ""
  const suffix = end < text.length ? "..." : ""

  return `${prefix}${text.slice(start, end).trim()}${suffix}`
}

function normalizeExcerptText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

export function normalizeSearchText(value: string): string {
  return normalizeExcerptText(value).toLowerCase()
}
