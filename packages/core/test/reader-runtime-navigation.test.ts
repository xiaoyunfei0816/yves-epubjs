import { describe, expect, it } from "vitest"
import type { Book, SectionDocument } from "../src/model/types"
import {
  EpubReader,
  createSharedChapterRenderInput,
  toCanvasChapterRenderInput
} from "../src"

function createCanvasChapter(title: string, paragraphCount = 40): string {
  const paragraphs = Array.from(
    { length: paragraphCount },
    (_, index) => `<p>Paragraph ${index + 1} in ${title}. This text is intentionally long enough to paginate.</p>`
  ).join("")

  return `<?xml version="1.0" encoding="utf-8"?>
    <html xmlns="http://www.w3.org/1999/xhtml">
      <head><title>${title}</title></head>
      <body>
        <section>
          <h1>${title}</h1>
          ${paragraphs}
        </section>
      </body>
    </html>`
}

const DOM_CHAPTER = `<?xml version="1.0" encoding="utf-8"?>
  <html xmlns="http://www.w3.org/1999/xhtml">
    <head><title>Complex Chapter</title></head>
    <body>
      <section>
        <h1>Complex Chapter</h1>
        <table>
          <tr><th>Name</th><th>Value</th></tr>
          <tr><td>Alpha</td><td>1</td></tr>
          <tr><td>Beta</td><td>2</td></tr>
        </table>
        <p>Tail paragraph for dom pagination checks.</p>
      </section>
    </body>
  </html>`

describe("EpubReader runtime navigation", () => {
  it("does not suppress the first user scroll relocation after an initial top-of-book render", async () => {
    const container = document.createElement("div")
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 260
    })
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 180
    })
    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0
    })
    document.body.appendChild(container)

    const reader = new EpubReader({ container, mode: "scroll" })
    const firstSection: SectionDocument = {
      ...toCanvasChapterRenderInput(
        createSharedChapterRenderInput({
          href: "OPS/chapter-1.xhtml",
          content: createCanvasChapter("Chapter 1")
        })
      ).section,
      id: "section-1"
    }
    const secondSection: SectionDocument = {
      ...toCanvasChapterRenderInput(
        createSharedChapterRenderInput({
          href: "OPS/chapter-2.xhtml",
          content: createCanvasChapter("Chapter 2")
        })
      ).section,
      id: "section-2"
    }

    const book: Book = {
      metadata: { title: "Scroll Sync" },
      manifest: [],
      spine: [
        { idref: "item-1", href: firstSection.href, linear: true },
        { idref: "item-2", href: secondSection.href, linear: true }
      ],
      toc: [],
      sections: [firstSection, secondSection]
    }

    ;(reader as unknown as { book: Book }).book = book
    await reader.render()

    const sectionElements = Array.from(container.querySelectorAll<HTMLElement>("[data-section-id]"))
    Object.defineProperty(sectionElements[0]!, "offsetTop", { configurable: true, value: 0 })
    Object.defineProperty(sectionElements[0]!, "offsetHeight", { configurable: true, value: 360 })
    Object.defineProperty(sectionElements[1]!, "offsetTop", { configurable: true, value: 360 })
    Object.defineProperty(sectionElements[1]!, "offsetHeight", { configurable: true, value: 360 })

    const relocated: Array<number> = []
    reader.on("relocated", ({ locator }) => {
      if (locator) {
        relocated.push(locator.spineIndex)
      }
    })

    container.scrollTop = 420
    container.dispatchEvent(new Event("scroll"))
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)))

    expect(reader.getCurrentLocation()?.spineIndex).toBe(1)
    expect(relocated).toEqual([1])
  })

  it("keeps global paginated page numbers when relocating into a dom chapter", async () => {
    const container = document.createElement("div")
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 320
    })
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 220
    })
    document.body.appendChild(container)

    const firstInput = createSharedChapterRenderInput({
      href: "OPS/chapter-1.xhtml",
      content: createCanvasChapter("Chapter 1", 60)
    })
    const domInput = createSharedChapterRenderInput({
      href: "OPS/chapter-2.xhtml",
      content: DOM_CHAPTER
    })
    const thirdInput = createSharedChapterRenderInput({
      href: "OPS/chapter-3.xhtml",
      content: createCanvasChapter("Chapter 3", 10)
    })

    const firstSection: SectionDocument = {
      ...toCanvasChapterRenderInput(firstInput).section,
      id: "section-1"
    }
    const domSection: SectionDocument = {
      ...toCanvasChapterRenderInput(domInput).section,
      id: "section-2"
    }
    const thirdSection: SectionDocument = {
      ...toCanvasChapterRenderInput(thirdInput).section,
      id: "section-3"
    }

    const book: Book = {
      metadata: { title: "Paginated DOM" },
      manifest: [],
      spine: [
        { idref: "item-1", href: firstSection.href, linear: true },
        { idref: "item-2", href: domSection.href, linear: true },
        { idref: "item-3", href: thirdSection.href, linear: true }
      ],
      toc: [],
      sections: [firstSection, domSection, thirdSection]
    }

    const reader = new EpubReader({ container, mode: "paginated" })
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
    ).chapterRenderInputs = [firstInput, domInput, thirdInput]

    await reader.render()
    await reader.goToLocation({
      spineIndex: 1,
      progressInSection: 0
    })

    expect(reader.getRenderMetrics().backend).toBe("dom")
    expect(reader.getCurrentLocation()?.spineIndex).toBe(1)
    expect(reader.getPaginationInfo().currentPage).toBeGreaterThan(1)
  })
})
