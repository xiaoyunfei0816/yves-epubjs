import { describe, expect, it, vi } from "vitest"
import type {
  Book,
  SectionDocument,
  SectionRelocatedEvent
} from "../src/model/types"
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

function createSingleBlockCanvasChapter(title: string, repetition = 1600): string {
  const text = Array.from(
    { length: repetition },
    (_, index) => `Segment ${index + 1} in ${title}. `
  ).join("")

  return `<?xml version="1.0" encoding="utf-8"?>
    <html xmlns="http://www.w3.org/1999/xhtml">
      <head><title>${title}</title></head>
      <body>
        <section>
          <h1>${title}</h1>
          <p>${text}</p>
        </section>
      </body>
    </html>`
}

function pickDeepestTextRun(container: HTMLElement): HTMLElement | null {
  const runs = Array.from(
    container.querySelectorAll<HTMLElement>(".epub-text-run")
  );
  if (runs.length === 0) {
    return null;
  }

  return runs.reduce((deepest, candidate) => {
    const deepestStart = Number.parseInt(
      deepest?.dataset.readerInlineStart ?? "0",
      10
    );
    const candidateStart = Number.parseInt(
      candidate.dataset.readerInlineStart ?? "0",
      10
    );
    return candidateStart > deepestStart ? candidate : deepest;
  }, runs[0] ?? null);
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
  it("notifies section relocation hooks and isolates hook failures", async () => {
    const container = document.createElement("div")
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 260
    })
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 180
    })
    document.body.appendChild(container)

    const onSectionRelocated = vi.fn<
      [SectionRelocatedEvent],
      void
    >(() => {
      throw new Error("hook failure")
    })
    const reader = new EpubReader({
      container,
      mode: "paginated",
      onSectionRelocated
    })
    const firstInput = createSharedChapterRenderInput({
      href: "OPS/chapter-1.xhtml",
      content: createCanvasChapter("Chapter 1", 20)
    })
    const secondInput = createSharedChapterRenderInput({
      href: "OPS/chapter-2.xhtml",
      content: createCanvasChapter("Chapter 2", 20)
    })
    const firstSection: SectionDocument = {
      ...toCanvasChapterRenderInput(firstInput).section,
      id: "section-1"
    }
    const secondSection: SectionDocument = {
      ...toCanvasChapterRenderInput(secondInput).section,
      id: "section-2"
    }

    const book: Book = {
      metadata: { title: "Relocation Hook" },
      manifest: [],
      spine: [
        { idref: "item-1", href: firstSection.href, linear: true },
        { idref: "item-2", href: secondSection.href, linear: true }
      ],
      toc: [],
      sections: [firstSection, secondSection]
    }

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
    ).chapterRenderInputs = [firstInput, secondInput]

    await reader.render()
    await reader.goToLocation({
      spineIndex: 1,
      progressInSection: 0
    })

    expect(onSectionRelocated).toHaveBeenCalled()
    expect(onSectionRelocated.mock.calls.at(-1)?.[0]).toMatchObject({
      spineIndex: 1,
      sectionId: "section-2",
      sectionHref: "OPS/chapter-2.xhtml",
      backend: "canvas",
      mode: "paginated",
      locator: {
        spineIndex: 1
      }
    })
    expect(reader.getCurrentLocation()?.spineIndex).toBe(1)
  })

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

  it("does not treat canvas text selection as a relocation click", async () => {
    const container = document.createElement("div")
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 320
    })
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 220
    })
    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0
    })
    document.body.appendChild(container)
    Object.defineProperty(container, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        right: 320,
        bottom: 220,
        width: 320,
        height: 220
      })
    })

    const input = createSharedChapterRenderInput({
      href: "OPS/chapter-1.xhtml",
      content: createCanvasChapter("Selectable Chapter", 8)
    })
    const section: SectionDocument = {
      ...toCanvasChapterRenderInput(input).section,
      id: "section-1"
    }
    const book: Book = {
      metadata: { title: "Canvas Selection" },
      manifest: [],
      spine: [{ idref: "item-1", href: section.href, linear: true }],
      toc: [],
      sections: [section]
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
    ).chapterRenderInputs = [input]

    const relocated = vi.fn()
    reader.on("relocated", relocated)

    await reader.render()

    const textRun = container.querySelector(".epub-text-run")
    expect(textRun).toBeTruthy()

    const originalGetSelection = window.getSelection
    const textNode = textRun?.firstChild ?? null
    Object.defineProperty(window, "getSelection", {
      configurable: true,
      value: () => ({
        toString: () => "Selectable",
        anchorNode: textNode,
        focusNode: textNode
      })
    })

    textRun?.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: 32,
        clientY: 24
      })
    )

    expect(relocated).not.toHaveBeenCalled()

    Object.defineProperty(window, "getSelection", {
      configurable: true,
      value: originalGetSelection
    })
  })

  it("keeps the centered canvas block anchored when switching from scroll to paginated", async () => {
    const container = document.createElement("div")
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 320
    })
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 240
    })
    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0
    })
    document.body.appendChild(container)

    const input = createSharedChapterRenderInput({
      href: "OPS/chapter-1.xhtml",
      content: createCanvasChapter("Anchored Chapter", 80)
    })
    const section: SectionDocument = {
      ...toCanvasChapterRenderInput(input).section,
      id: "section-1"
    }
    const book: Book = {
      metadata: { title: "Anchored Canvas Switch" },
      manifest: [],
      spine: [{ idref: "item-1", href: section.href, linear: true }],
      toc: [],
      sections: [section]
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
    ).chapterRenderInputs = [input]

    await reader.render()
    container.scrollTop = 640

    const expected = reader.mapViewportToLocator({
      x: container.clientWidth / 2,
      y: container.clientHeight / 2
    })
    expect(expected?.blockId).toBeTruthy()

    await reader.submitPreferences({
      mode: "paginated"
    })

    expect(reader.getSettings().mode).toBe("paginated")
    expect(reader.getCurrentLocation()?.blockId).toBe(expected?.blockId)
  })

  it("keeps a deep inline position inside a single canvas block when switching from scroll to paginated", async () => {
    const container = document.createElement("div")
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 320
    })
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 240
    })
    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0
    })
    document.body.appendChild(container)

    const input = createSharedChapterRenderInput({
      href: "OPS/chapter-1.xhtml",
      content: createSingleBlockCanvasChapter("Single Block Scroll Switch", 5200)
    })
    const section: SectionDocument = {
      ...toCanvasChapterRenderInput(input).section,
      id: "section-1"
    }
    const book: Book = {
      metadata: { title: "Single Block Scroll Switch" },
      manifest: [],
      spine: [{ idref: "item-1", href: section.href, linear: true }],
      toc: [],
      sections: [section]
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
    ).chapterRenderInputs = [input]

    const originalElementFromPoint = Object.getOwnPropertyDescriptor(
      document,
      "elementFromPoint"
    )

    try {
      await reader.render()
      container.scrollTop = 3600
      container.dispatchEvent(new Event("scroll"))
      await new Promise((resolve) =>
        window.requestAnimationFrame(() => resolve(undefined))
      )

      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => pickDeepestTextRun(container)
      })

      await reader.submitPreferences({
        mode: "paginated"
      })

      expect(reader.getSettings().mode).toBe("paginated")
      expect(reader.getPaginationInfo().totalPages).toBeGreaterThan(1)
      expect(reader.getCurrentLocation()?.inlineOffset ?? 0).toBeGreaterThan(0)
    } finally {
      if (originalElementFromPoint) {
        Object.defineProperty(
          document,
          "elementFromPoint",
          originalElementFromPoint
        )
      } else {
        delete (document as Document & { elementFromPoint?: unknown })
          .elementFromPoint
      }
    }
  })

  it("keeps a deep inline position inside a single canvas block when switching from paginated to scroll", async () => {
    const container = document.createElement("div")
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 320
    })
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 240
    })
    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0
    })
    document.body.appendChild(container)

    const input = createSharedChapterRenderInput({
      href: "OPS/chapter-1.xhtml",
      content: createSingleBlockCanvasChapter("Single Block Paginated Switch")
    })
    const section: SectionDocument = {
      ...toCanvasChapterRenderInput(input).section,
      id: "section-1"
    }
    const book: Book = {
      metadata: { title: "Single Block Paginated Switch" },
      manifest: [],
      spine: [{ idref: "item-1", href: section.href, linear: true }],
      toc: [],
      sections: [section]
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
    ).chapterRenderInputs = [input]

    const originalElementFromPoint = Object.getOwnPropertyDescriptor(
      document,
      "elementFromPoint"
    )

    try {
      await reader.render()
      expect(reader.getPaginationInfo().totalPages).toBeGreaterThan(4)
      await reader.goToPage(4)

      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => pickDeepestTextRun(container)
      })

      await reader.submitPreferences({
        mode: "scroll"
      })

      expect(reader.getSettings().mode).toBe("scroll")
      expect(container.scrollTop).toBeGreaterThan(100)
      expect(reader.getCurrentLocation()?.inlineOffset ?? 0).toBeGreaterThan(0)
    } finally {
      if (originalElementFromPoint) {
        Object.defineProperty(
          document,
          "elementFromPoint",
          originalElementFromPoint
        )
      } else {
        delete (document as Document & { elementFromPoint?: unknown })
          .elementFromPoint
      }
    }
  })
})
