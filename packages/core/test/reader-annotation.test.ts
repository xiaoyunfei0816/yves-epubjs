import { describe, expect, it } from "vitest"
import type { Book, SectionDocument } from "../src/model/types"
import { EpubReader } from "../src/runtime/reader"

describe("EpubReader annotations", () => {
  it("creates annotations from the current locator and derives quote text", async () => {
    const container = document.createElement("div")
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 320
    })
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 480
    })

    const reader = new EpubReader({ container, mode: "scroll" })
    const section: SectionDocument = {
      id: "section-1",
      href: "OPS/chapter-1.xhtml",
      title: "Chapter 1",
      anchors: {},
      blocks: [
        {
          id: "text-1",
          kind: "text",
          inlines: [{ kind: "text", text: "Annotation target paragraph." }]
        }
      ]
    }
    ;(reader as unknown as { book: Book; sourceName: string | null }).book = {
      metadata: { title: "Annotations" },
      manifest: [],
      spine: [{ idref: "item-1", href: section.href, linear: true }],
      toc: [],
      sections: [section]
    }
    ;(reader as unknown as { book: Book; sourceName: string | null }).sourceName = "sample.epub"

    await reader.goToLocation({
      spineIndex: 0,
      blockId: "text-1",
      progressInSection: 0
    })

    const annotation = reader.createAnnotation({ note: "Remember this", color: "#f59e0b" })
    expect(annotation?.publicationId).toBe("title:Annotations::source:sample.epub")
    expect(annotation?.quote).toBe("Annotation target paragraph.")
    expect(annotation?.note).toBe("Remember this")
  })

  it("stores annotations and exposes them as annotation decorations", () => {
    const container = document.createElement("div")
    const reader = new EpubReader({ container, mode: "scroll" })

    ;(reader as unknown as { book: Book }).book = {
      metadata: { title: "Annotations", identifier: "urn:uuid:annotations" },
      manifest: [],
      spine: [],
      toc: [],
      sections: []
    }

    reader.setAnnotations([
      {
        id: "annotation-1",
        publicationId: "identifier:urn:uuid:annotations",
        locator: {
          spineIndex: 0,
          blockId: "text-1",
          progressInSection: 0.2
        },
        quote: "Target paragraph",
        note: "Important",
        color: "#f59e0b",
        createdAt: "2026-04-18T11:00:00.000Z",
        updatedAt: "2026-04-18T11:05:00.000Z"
      }
    ])

    expect(reader.getAnnotations()).toHaveLength(1)
    expect(reader.getDecorations("annotations")).toEqual([
      {
        id: "annotation:annotation-1",
        group: "annotations",
        locator: {
          spineIndex: 0,
          blockId: "text-1",
          progressInSection: 0.2
        },
        style: "highlight",
        color: "#f59e0b"
      }
    ])

    reader.clearAnnotations()
    expect(reader.getAnnotations()).toHaveLength(0)
    expect(reader.getDecorations("annotations")).toHaveLength(0)
  })
})
