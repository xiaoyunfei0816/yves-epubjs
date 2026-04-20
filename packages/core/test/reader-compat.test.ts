import { describe, expect, it } from "vitest"
import type { Book, ReaderOptions, SectionDocument } from "../src/model/types"
import { EpubReader } from "../src/runtime/reader"

describe("EpubReader compatibility behavior", () => {
  it("exposes citic integration contracts on the public reader surface", () => {
    const options: ReaderOptions = {
      onSectionRendered: async () => {},
      onSectionRelocated: async () => {}
    }
    const reader = new EpubReader(options)

    expect(typeof reader.getReadingProgress).toBe("function")
    expect(typeof reader.goToProgress).toBe("function")
    expect(typeof reader.goToHref).toBe("function")
    expect(typeof reader.resolveHrefLocator).toBe("function")
    expect(typeof reader.getTocTargets).toBe("function")
  })

  it("searches text from figure captions, tables, definition lists, and inline image alt text", async () => {
    const container = document.createElement("div")
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 320
    })
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 480
    })

    const reader = new EpubReader({ container, mode: "paginated" })
    const section: SectionDocument = {
      id: "section-search-compat",
      href: "OPS/search-compat.xhtml",
      title: "Compatibility Search",
      anchors: {},
      blocks: [
        {
          id: "figure-1",
          kind: "figure",
          blocks: [],
          caption: [
            {
              id: "caption-1",
              kind: "text",
              inlines: [{ kind: "text", text: "Figure caption text" }]
            }
          ]
        },
        {
          id: "table-1",
          kind: "table",
          caption: [
            {
              id: "table-caption-1",
              kind: "text",
              inlines: [{ kind: "text", text: "Score table" }]
            }
          ],
          rows: [
            {
              id: "row-1",
              cells: [
                {
                  id: "cell-1",
                  blocks: [{ id: "cell-text-1", kind: "text", inlines: [{ kind: "text", text: "Alice" }] }]
                }
              ]
            }
          ]
        },
        {
          id: "dl-1",
          kind: "definition-list",
          items: [
            {
              id: "definition-item-1",
              term: [{ id: "term-1", kind: "text", inlines: [{ kind: "text", text: "Term" }] }],
              descriptions: [
                [{ id: "description-1", kind: "text", inlines: [{ kind: "text", text: "Definition body" }] }]
              ]
            }
          ]
        },
        {
          id: "text-1",
          kind: "text",
          inlines: [
            {
              kind: "image",
              src: "OPS/images/icon.png",
              alt: "searchable icon",
              width: 18,
              height: 18
            }
          ]
        }
      ]
    }

    const book: Book = {
      metadata: { title: "Compatibility Search" },
      manifest: [],
      spine: [
        {
          idref: "item-1",
          href: section.href,
          linear: true
        }
      ],
      toc: [],
      sections: [section]
    }

    ;(reader as unknown as { book: Book }).book = book

    expect((await reader.search("caption")).map((result) => result.locator.blockId)).toContain("caption-1")
    expect((await reader.search("Alice")).map((result) => result.locator.blockId)).toContain("cell-text-1")
    expect((await reader.search("Definition body")).map((result) => result.locator.blockId)).toContain("description-1")
    expect((await reader.search("searchable icon")).map((result) => result.locator.blockId)).toContain("text-1")
  })

  it("hit tests inline images inside pretext paragraphs", async () => {
    const container = document.createElement("div")
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 240
    })
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 240
    })

    const reader = new EpubReader({ container, mode: "paginated" })
    const section: SectionDocument = {
      id: "section-inline-image-hit",
      href: "OPS/inline-image-hit.xhtml",
      title: "Inline Image Hit",
      anchors: {},
      blocks: [
        {
          id: "text-inline-image",
          kind: "text",
          inlines: [
            {
              kind: "image",
              src: "OPS/images/icon.png",
              alt: "icon",
              width: 24,
              height: 24
            },
            { kind: "text", text: " tail" }
          ]
        }
      ]
    }

    const book: Book = {
      metadata: { title: "Inline Image Hit" },
      manifest: [],
      spine: [
        {
          idref: "item-1",
          href: section.href,
          linear: true
        }
      ],
      toc: [],
      sections: [section]
    }

    ;(reader as unknown as { book: Book }).book = book
    await reader.render()

    const imageRegion = (
      reader as unknown as {
        lastInteractionRegions: Array<{
          kind: string
          rect: { x: number; y: number; width: number; height: number }
        }>
      }
    ).lastInteractionRegions.find((region) => region.kind === "image")

    const hit = reader.hitTest({
      x: imageRegion ? imageRegion.rect.x + imageRegion.rect.width * 0.5 : 20,
      y: imageRegion ? imageRegion.rect.y + imageRegion.rect.height * 0.5 : 16
    })

    expect(imageRegion).toBeTruthy()
    expect(hit?.kind).toBe("image")
    expect(hit && hit.kind === "image" ? hit.blockId : undefined).toBe("text-inline-image")
  })
})
