import { describe, expect, it } from "vitest"
import type { SectionDocument } from "../src/model/types"
import { buildSearchResultsForSection } from "../src/runtime/search-results"

describe("search results", () => {
  it("prefers the deepest matching block instead of returning only the parent container", () => {
    const section: SectionDocument = {
      id: "section-1",
      href: "OPS/chapter.xhtml",
      anchors: {},
      blocks: [
        {
          id: "table-1",
          kind: "table",
          rows: [
            {
              id: "table-row-1",
              cells: [
                {
                  id: "table-cell-1",
                  blocks: [
                    {
                      id: "text-1",
                      kind: "text",
                      inlines: [{ kind: "text", text: "Intro text" }]
                    },
                    {
                      id: "text-2",
                      kind: "text",
                      inlines: [{ kind: "text", text: "DOM search target" }]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }

    const results = buildSearchResultsForSection({
      section,
      spineIndex: 0,
      query: "DOM search target"
    })

    expect(results).toHaveLength(1)
    expect(results[0]?.locator.blockId).toBe("text-2")
    expect(results[0]?.matchText).toBe("DOM search target")
    expect(results[0]?.excerpt).toBe("DOM search target")
  })

  it("creates a clipped excerpt around the first match in long blocks", () => {
    const section: SectionDocument = {
      id: "section-1",
      href: "OPS/chapter.xhtml",
      anchors: {},
      blocks: [
        {
          id: "text-1",
          kind: "text",
          inlines: [
            {
              kind: "text",
              text:
                "Opening context ".repeat(10) +
                "target phrase " +
                "closing context ".repeat(10)
            }
          ]
        }
      ]
    }

    const results = buildSearchResultsForSection({
      section,
      spineIndex: 0,
      query: "target phrase"
    })

    expect(results).toHaveLength(1)
    expect(results[0]?.excerpt.length).toBeLessThan(160)
    expect(results[0]?.excerpt).toContain("target phrase")
  })
})
