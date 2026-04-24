import type { BlockNode } from "../model/types"

export function findBlockById(
  blocks: BlockNode[],
  blockId: string
): BlockNode | null {
  for (const block of blocks) {
    if (block.id === blockId) {
      return block
    }

    const nested = findNestedBlockById(block, blockId)
    if (nested) {
      return nested
    }
  }

  return null
}

export function resolveRenderableBlockId(
  blocks: BlockNode[],
  blockId: string
): string | undefined {
  for (const block of blocks) {
    if (block.id === blockId) {
      return block.id
    }

    if (findNestedBlockById(block, blockId)) {
      return block.id
    }
  }

  return undefined
}

function findNestedBlockById(
  block: BlockNode,
  blockId: string
): BlockNode | null {
  switch (block.kind) {
    case "quote":
    case "aside":
    case "nav":
    case "figure":
      return findBlockById(
        block.kind === "figure"
          ? [...block.blocks, ...(block.caption ?? [])]
          : block.blocks,
        blockId
      )
    case "list":
      for (const item of block.items) {
        const nested = findBlockById(item.blocks, blockId)
        if (nested) {
          return nested
        }
      }
      return null
    case "table":
      for (const candidate of [
        ...(block.caption ?? []),
        ...block.rows.flatMap((row) => row.cells.flatMap((cell) => cell.blocks))
      ]) {
        if (candidate.id === blockId) {
          return candidate
        }
        const nested = findNestedBlockById(candidate, blockId)
        if (nested) {
          return nested
        }
      }
      return null
    case "definition-list":
      for (const item of block.items) {
        const nested = findBlockById(
          [
            ...item.term,
            ...item.descriptions.flatMap((description) => description)
          ],
          blockId
        )
        if (nested) {
          return nested
        }
      }
      return null
    default:
      return null
  }
}
