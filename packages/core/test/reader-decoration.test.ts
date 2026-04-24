import { describe, expect, it } from "vitest"
import type { Book, SectionDocument } from "../src/model/types"
import {
  EpubReader,
  createSharedChapterRenderInput,
  toCanvasChapterRenderInput
} from "../src"

describe("EpubReader decorations", () => {
  it("routes search and current location through decoration groups", async () => {
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
          inlines: [{ kind: "text", text: "Canvas search target." }]
        }
      ]
    }
    ;(reader as unknown as { book: Book }).book = {
      metadata: { title: "Decorations" },
      manifest: [],
      spine: [{ idref: "item-1", href: section.href, linear: true }],
      toc: [],
      sections: [section]
    }

    await reader.search("Canvas search target")
    expect(reader.getDecorations("search-results")).toHaveLength(1)

    await reader.goToLocation({
      spineIndex: 0,
      blockId: "text-1",
      progressInSection: 0
    })
    reader.setDebugMode(true)

    expect(reader.getDecorations("current-location")).toEqual([
      {
        id: "current-location:active",
        group: "current-location",
        locator: {
          spineIndex: 0,
          blockId: "text-1",
          progressInSection: 0
        },
        style: "active"
      }
    ])

    reader.clearDecorations("search-results")
    expect(reader.getDecorations("search-results")).toHaveLength(0)
  })

  it("applies basic highlight decorations on dom chapters", async () => {
    const container = document.createElement("div")
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 320
    })
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 480
    })
    document.body.appendChild(container)

    const domInput = createSharedChapterRenderInput({
      href: "OPS/dom.xhtml",
      content: `<?xml version="1.0" encoding="utf-8"?>
        <html xmlns="http://www.w3.org/1999/xhtml">
          <body>
            <section>
              <h2 id="details">Details</h2>
              <table><tr><td>Complex chapter</td></tr></table>
            </section>
          </body>
        </html>`
    })
    const domSection: SectionDocument = {
      ...toCanvasChapterRenderInput(domInput).section,
      id: "section-1"
    }
    const book: Book = {
      metadata: { title: "DOM decorations" },
      manifest: [],
      spine: [{ idref: "item-1", href: domSection.href, linear: true }],
      toc: [],
      sections: [domSection]
    }

    const reader = new EpubReader({ container, mode: "scroll" })
    ;(
      reader as unknown as {
        book: Book
        chapterRenderInputs: ReturnType<typeof createSharedChapterRenderInput>[]
      }
    ).book = book
    ;(
      reader as unknown as {
        book: Book
        chapterRenderInputs: ReturnType<typeof createSharedChapterRenderInput>[]
      }
    ).chapterRenderInputs = [domInput]

    await reader.render()
    reader.setDecorations({
      group: "manual",
      decorations: [
        {
          id: "manual-1",
          group: "manual",
          locator: {
            spineIndex: 0,
            anchorId: "details",
            progressInSection: 0.1
          },
          style: "highlight"
        }
      ]
    })

    expect(
      container
        .querySelector("#details")
        ?.classList.contains("epub-dom-decoration-highlight")
    ).toBe(true)
  })
})
