import { describe, expect, it } from "vitest"
import type { Book, SectionDocument } from "../src/model/types"
import { createSharedChapterRenderInput } from "../src/runtime/chapter-render-input"
import { EpubReader } from "../src/runtime/reader"

function createContainer(): HTMLDivElement {
  const container = document.createElement("div")
  Object.defineProperty(container, "clientWidth", {
    configurable: true,
    value: 1200
  })
  Object.defineProperty(container, "clientHeight", {
    configurable: true,
    value: 800
  })
  Object.defineProperty(container, "scrollLeft", {
    configurable: true,
    writable: true,
    value: 0
  })
  Object.defineProperty(container, "scrollTop", {
    configurable: true,
    writable: true,
    value: 0
  })
  Object.defineProperty(container, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1200,
      bottom: 800,
      width: 1200,
      height: 800,
      toJSON() {
        return this
      }
    })
  })
  document.body.appendChild(container)
  return container
}

function createFixedLayoutSection(
  overrides: Partial<SectionDocument> = {}
): SectionDocument {
  return {
    id: "section-1",
    href: "OPS/fxl.xhtml",
    title: "FXL",
    renditionLayout: "pre-paginated",
    renditionViewport: {
      width: 1200,
      height: 1600
    },
    anchors: {},
    blocks: [],
    ...overrides
  }
}

function createFixedLayoutBook(sectionCount: number): Book {
  const sections = Array.from({ length: sectionCount }, (_, index) =>
    createFixedLayoutSection({
      id: `section-${index + 1}`,
      href: `OPS/fxl-${index + 1}.xhtml`,
      title: `FXL ${index + 1}`
    })
  )

  return {
    metadata: {
      title: "FXL Spread Reader",
      renditionLayout: "pre-paginated",
      renditionSpread: "auto"
    },
    manifest: [],
    spine: sections.map((section, index) => ({
      idref: `item-${index + 1}`,
      href: section.href,
      linear: true
    })),
    toc: [],
    sections
  }
}

function createFixedLayoutInputs(book: Book): Array<{
  href: string
  content: string
  preprocessed: {
    href: string
    nodes: []
  }
}> {
  return book.sections.map((section) => ({
    href: section.href,
    content: "<html><body></body></html>",
    preprocessed: {
      href: section.href,
      nodes: []
    }
  }))
}

describe("EpubReader spread context", () => {
  it("exposes synthetic spread state and partitions fixed-layout pages in paginated mode", async () => {
    const container = createContainer()
    const reader = new EpubReader({
      container,
      mode: "paginated"
    })
    const section = createFixedLayoutSection()

    ;(reader as unknown as { book: Book }).book = {
      metadata: {
        title: "FXL Spread Reader",
        renditionLayout: "pre-paginated",
        renditionSpread: "auto"
      },
      manifest: [],
      spine: [{ idref: "item-1", href: section.href, linear: true }],
      toc: [],
      sections: [section]
    }

    ;(
      reader as unknown as {
        chapterRenderInputs: Array<{
          href: string
          content: string
          preprocessed: {
            href: string
            nodes: []
          }
        }>
        createDomRenderInput(
          section: SectionDocument,
          input: {
            href: string
            content: string
            preprocessed: {
              href: string
              nodes: []
            }
          }
        ): {
          fixedLayoutRenderWidth?: number
          fixedLayoutRenderHeight?: number
          fixedLayoutScale?: number
        }
      }
    ).chapterRenderInputs = [
      {
        href: section.href,
        content: "<html><body></body></html>",
        preprocessed: {
          href: section.href,
          nodes: []
        }
      }
    ]

    await reader.render()

    expect(reader.getReadingSpreadContext()).toEqual({
      spineIndex: 0,
      sectionId: "section-1",
      sectionHref: "OPS/fxl.xhtml",
      spreadMode: "auto",
      renditionLayout: "pre-paginated",
      renditionSpread: "auto",
      pageSpreadPlacement: "right",
      syntheticSpreadAllowed: true,
      syntheticSpreadActive: true,
      viewportSlotCount: 2
    })
    expect(container.dataset.syntheticSpread).toBe("enabled")
    expect(container.dataset.pageSpreadPlacement).toBe("right")
    expect(container.dataset.viewportSlotCount).toBe("2")

    const state = reader as unknown as {
      chapterRenderInputs: Array<{
        href: string
        content: string
        preprocessed: {
          href: string
          nodes: []
        }
      }>
      createDomRenderInput(
        section: SectionDocument,
        input: {
          href: string
          content: string
          preprocessed: {
            href: string
            nodes: []
          }
        }
      ): {
        fixedLayoutRenderWidth?: number
        fixedLayoutRenderHeight?: number
        fixedLayoutScale?: number
      }
    }

    expect(state.createDomRenderInput(section, state.chapterRenderInputs[0]!).fixedLayoutRenderWidth).toBe(588)
    expect(state.createDomRenderInput(section, state.chapterRenderInputs[0]!).fixedLayoutRenderHeight).toBe(784)
    expect(state.createDomRenderInput(section, state.chapterRenderInputs[0]!).fixedLayoutScale).toBe(0.49)
    expect(reader.getRenderDiagnostics()).toMatchObject({
      spreadMode: "auto",
      pageSpreadPlacement: "right",
      syntheticSpreadActive: true,
      viewportSlotCount: 2
    })
  })

  it("disables synthetic spread when reader spread mode is none", async () => {
    const container = createContainer()
    const reader = new EpubReader({
      container,
      mode: "paginated",
      preferences: {
        spreadMode: "none"
      }
    })
    const section = createFixedLayoutSection({
      pageSpreadPlacement: "left"
    })

    ;(reader as unknown as { book: Book }).book = {
      metadata: {
        title: "FXL No Spread",
        renditionLayout: "pre-paginated",
        renditionSpread: "both"
      },
      manifest: [],
      spine: [{ idref: "item-1", href: section.href, linear: true, pageSpreadPlacement: "left" }],
      toc: [],
      sections: [section]
    }

    ;(
      reader as unknown as {
        chapterRenderInputs: Array<{
          href: string
          content: string
          preprocessed: {
            href: string
            nodes: []
          }
        }>
      }
    ).chapterRenderInputs = [
      {
        href: section.href,
        content: "<html><body></body></html>",
        preprocessed: {
          href: section.href,
          nodes: []
        }
      }
    ]

    await reader.render()

    expect(reader.getReadingSpreadContext()).toMatchObject({
      spreadMode: "none",
      renditionSpread: "both",
      pageSpreadPlacement: "left",
      syntheticSpreadAllowed: false,
      syntheticSpreadActive: false,
      viewportSlotCount: 1
    })
    expect(container.dataset.syntheticSpread).toBe("disabled")
  })

  it("renders a blank leading slot for the first right-page spread and pairs subsequent pages", async () => {
    const container = createContainer()
    const reader = new EpubReader({
      container,
      mode: "paginated"
    })
    const book = createFixedLayoutBook(3)

    ;(reader as unknown as { book: Book }).book = book
    ;(
      reader as unknown as {
        chapterRenderInputs: Array<{
          href: string
          content: string
          preprocessed: {
            href: string
            nodes: []
          }
        }>
      }
    ).chapterRenderInputs = createFixedLayoutInputs(book)

    await reader.render()

    expect(reader.getPaginationInfo()).toEqual({
      currentPage: 1,
      totalPages: 2
    })
    expect(container.querySelector('[data-spread-slot="left"].epub-dom-spread-slot-blank')).not.toBeNull()
    expect(
      container.querySelector('[data-spread-slot="right"] .epub-dom-section')?.getAttribute("data-section-id")
    ).toBe("section-1")

    await reader.goToPage(2)
    expect(reader.getPaginationInfo()).toEqual({
      currentPage: 2,
      totalPages: 2
    })

    expect(
      container.querySelector('[data-spread-slot="left"] .epub-dom-section')?.getAttribute("data-section-id")
    ).toBe("section-2")
    expect(
      container.querySelector('[data-spread-slot="right"] .epub-dom-section')?.getAttribute("data-section-id")
    ).toBe("section-3")
    expect(reader.getVisibleSectionDiagnostics().map((entry) => entry.sectionId)).toEqual([
      "section-2",
      "section-3"
    ])
  })

  it("navigates between paired spreads instead of single fixed-layout pages", async () => {
    const container = createContainer()
    const reader = new EpubReader({
      container,
      mode: "paginated"
    })
    const book = createFixedLayoutBook(5)

    ;(reader as unknown as { book: Book }).book = book
    ;(
      reader as unknown as {
        chapterRenderInputs: Array<{
          href: string
          content: string
          preprocessed: {
            href: string
            nodes: []
          }
        }>
      }
    ).chapterRenderInputs = createFixedLayoutInputs(book)

    await reader.render()
    expect(reader.getPaginationInfo()).toEqual({
      currentPage: 1,
      totalPages: 3
    })

    await reader.next()
    expect(reader.getPaginationInfo().currentPage).toBe(2)
    expect(
      container.querySelector('[data-spread-slot="left"] .epub-dom-section')?.getAttribute("data-section-id")
    ).toBe("section-2")
    expect(
      container.querySelector('[data-spread-slot="right"] .epub-dom-section')?.getAttribute("data-section-id")
    ).toBe("section-3")

    await reader.next()
    expect(reader.getPaginationInfo().currentPage).toBe(3)
    expect(
      container.querySelector('[data-spread-slot="left"] .epub-dom-section')?.getAttribute("data-section-id")
    ).toBe("section-4")
    expect(
      container.querySelector('[data-spread-slot="right"] .epub-dom-section')?.getAttribute("data-section-id")
    ).toBe("section-5")

    await reader.prev()
    expect(reader.getPaginationInfo().currentPage).toBe(2)
  })

  it("uses spread page numbers for page jump and bookmark restore", async () => {
    const container = createContainer()
    const reader = new EpubReader({
      container,
      mode: "paginated"
    })
    const book = createFixedLayoutBook(5)

    ;(reader as unknown as { book: Book }).book = book
    ;(
      reader as unknown as {
        chapterRenderInputs: Array<{
          href: string
          content: string
          preprocessed: {
            href: string
            nodes: []
          }
        }>
      }
    ).chapterRenderInputs = createFixedLayoutInputs(book)

    await reader.render()
    await reader.goToPage(3)

    expect(reader.getPaginationInfo()).toEqual({
      currentPage: 3,
      totalPages: 3
    })
    expect(
      container.querySelector('[data-spread-slot="left"] .epub-dom-section')?.getAttribute("data-section-id")
    ).toBe("section-4")
    expect(
      container.querySelector('[data-spread-slot="right"] .epub-dom-section')?.getAttribute("data-section-id")
    ).toBe("section-5")

    const bookmark = reader.createBookmark({ label: "spread-third" })
    expect(bookmark?.locator.href).toBe("OPS/fxl-4.xhtml")

    await reader.goToPage(1)
    expect(reader.getPaginationInfo().currentPage).toBe(1)

    const restored = await reader.restoreBookmark(bookmark!)
    expect(restored).toBe(true)
    expect(reader.getPaginationInfo()).toEqual({
      currentPage: 3,
      totalPages: 3
    })
    expect(reader.getCurrentLocation()?.spineIndex).toBe(3)
  })

  it("lands toc navigation on the resolved spread page", async () => {
    const container = createContainer()
    const reader = new EpubReader({
      container,
      mode: "paginated"
    })
    const book = createFixedLayoutBook(5)
    book.toc = [
      {
        id: "toc-four",
        label: "Page Four",
        href: "OPS/fxl-4.xhtml",
        children: []
      }
    ]

    ;(reader as unknown as { book: Book }).book = book
    ;(
      reader as unknown as {
        chapterRenderInputs: Array<{
          href: string
          content: string
          preprocessed: {
            href: string
            nodes: []
          }
        }>
      }
    ).chapterRenderInputs = createFixedLayoutInputs(book)

    await reader.render()
    await reader.goToTocItem("toc-four")

    expect(reader.getPaginationInfo()).toEqual({
      currentPage: 3,
      totalPages: 3
    })
    expect(reader.getCurrentLocation()?.spineIndex).toBe(3)
  })

  it("uses blank slots and physical spread halves as paginated navigation targets", async () => {
    const container = createContainer()
    const reader = new EpubReader({
      container,
      mode: "paginated"
    })
    const book = createFixedLayoutBook(5)

    ;(reader as unknown as { book: Book }).book = book
    ;(
      reader as unknown as {
        chapterRenderInputs: Array<{
          href: string
          content: string
          preprocessed: {
            href: string
            nodes: []
          }
        }>
      }
    ).chapterRenderInputs = createFixedLayoutInputs(book)

    await reader.render()
    const blankLeft = container.querySelector<HTMLElement>('[data-spread-slot="left"]')
    blankLeft?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 120, clientY: 400 }))
    await Promise.resolve()
    await Promise.resolve()
    expect(reader.getPaginationInfo().currentPage).toBe(1)

    const firstRightSection = container.querySelector<HTMLElement>(
      '[data-spread-slot="right"] .epub-dom-section'
    )
    firstRightSection?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: 980, clientY: 400 })
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(reader.getPaginationInfo().currentPage).toBe(2)

    const secondLeftSection = container.querySelector<HTMLElement>(
      '[data-spread-slot="left"] .epub-dom-section'
    )
    secondLeftSection?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: 220, clientY: 400 })
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(reader.getPaginationInfo().currentPage).toBe(1)
  })

  it("keeps page links higher priority than spread click navigation", async () => {
    const container = createContainer()
    const reader = new EpubReader({
      container,
      mode: "paginated"
    })
    const firstSection = createFixedLayoutSection({
      id: "section-1",
      href: "OPS/fxl-1.xhtml",
      blocks: [
        {
          id: "text-1",
          kind: "text",
          inlines: [{ kind: "link", href: "OPS/fxl-2.xhtml", children: [{ kind: "text", text: "Next page" }] }]
        }
      ]
    })
    const secondSection = createFixedLayoutSection({
      id: "section-2",
      href: "OPS/fxl-2.xhtml"
    })
    const book: Book = {
      metadata: {
        title: "FXL Link Spread",
        renditionLayout: "pre-paginated",
        renditionSpread: "auto"
      },
      manifest: [],
      spine: [
        { idref: "item-1", href: firstSection.href, linear: true },
        { idref: "item-2", href: secondSection.href, linear: true }
      ],
      toc: [],
      sections: [firstSection, secondSection]
    }

    ;(reader as unknown as { book: Book }).book = book
    ;(
      reader as unknown as {
        chapterRenderInputs: Array<ReturnType<typeof createSharedChapterRenderInput>>
      }
    ).chapterRenderInputs = [
      createSharedChapterRenderInput({
        href: firstSection.href,
        content: `<?xml version="1.0"?><html><body><p><a href="OPS/fxl-2.xhtml">Next page</a></p></body></html>`
      }),
      createSharedChapterRenderInput({
        href: secondSection.href,
        content: `<?xml version="1.0"?><html><body><p>Second page</p></body></html>`
      })
    ]

    await reader.render()
    const link = container.querySelector<HTMLAnchorElement>('a[href="OPS/fxl-2.xhtml"]')
    link?.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: 980,
        clientY: 400
      })
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(reader.getPaginationInfo()).toEqual({
      currentPage: 2,
      totalPages: 2
    })
    expect(reader.getCurrentLocation()?.spineIndex).toBe(1)
  })

  it("keeps search, current location, and annotation decorations visible across paired spread pages", async () => {
    const container = createContainer()
    const reader = new EpubReader({
      container,
      mode: "paginated"
    })
    const firstSection = createFixedLayoutSection({
      id: "section-1",
      href: "OPS/fxl-1.xhtml"
    })
    const secondSection = createFixedLayoutSection({
      id: "section-2",
      href: "OPS/fxl-2.xhtml"
    })
    const thirdSection = createFixedLayoutSection({
      id: "section-3",
      href: "OPS/fxl-3.xhtml"
    })
    const book: Book = {
      metadata: {
        title: "FXL Decoration Spread",
        identifier: "urn:uuid:fxl-decoration-spread",
        renditionLayout: "pre-paginated",
        renditionSpread: "auto"
      },
      manifest: [],
      spine: [
        { idref: "item-1", href: firstSection.href, linear: true },
        { idref: "item-2", href: secondSection.href, linear: true },
        { idref: "item-3", href: thirdSection.href, linear: true }
      ],
      toc: [],
      sections: [firstSection, secondSection, thirdSection]
    }

    ;(reader as unknown as { book: Book }).book = book
    ;(
      reader as unknown as {
        chapterRenderInputs: Array<ReturnType<typeof createSharedChapterRenderInput>>
      }
    ).chapterRenderInputs = [
      createSharedChapterRenderInput({
        href: firstSection.href,
        content: `<?xml version="1.0"?><html><body><p>First page</p></body></html>`
      }),
      createSharedChapterRenderInput({
        href: secondSection.href,
        content: `<?xml version="1.0"?><html><body><p id="left-search">Left spread search result</p></body></html>`
      }),
      createSharedChapterRenderInput({
        href: thirdSection.href,
        content: `<?xml version="1.0"?><html><body><p id="right-note">Right spread annotation target</p></body></html>`
      })
    ]

    await reader.render()
    await reader.goToPage(2)

    reader.setDecorations({
      group: "search-results",
      decorations: [
        {
          id: "search:left",
          group: "search-results",
          locator: {
            spineIndex: 1,
            blockId: "left-search",
            progressInSection: 0.1
          },
          style: "search-hit"
        }
      ]
    })
    reader.setAnnotations([
      {
        id: "annotation-right",
        publicationId: "identifier:urn:uuid:fxl-decoration-spread",
        locator: {
          spineIndex: 2,
          blockId: "right-note",
          progressInSection: 0.2
        },
        quote: "Right spread annotation target",
        note: "Important",
        createdAt: "2026-04-18T13:00:00.000Z",
        updatedAt: "2026-04-18T13:00:00.000Z"
      }
    ])
    await reader.goToLocation({
      spineIndex: 2,
      blockId: "right-note",
      progressInSection: 0
    })

    expect(reader.getPaginationInfo()).toEqual({
      currentPage: 2,
      totalPages: 2
    })
    expect(container.querySelector("#left-search")?.classList.contains("epub-dom-decoration-search-hit")).toBe(
      true
    )
    expect(container.querySelector("#right-note")?.classList.contains("epub-dom-decoration-highlight")).toBe(
      true
    )
    expect(container.querySelector("#right-note")?.classList.contains("epub-dom-decoration-active")).toBe(
      true
    )
  })

  it("realigns spread search results precisely and exposes annotation viewport snapshots", async () => {
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")
    const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight")
    const originalGetBoundingClientRect = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "getBoundingClientRect"
    )

    try {
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get() {
          const element = this as HTMLElement
          if (element.classList.contains("epub-dom-section")) {
            return 784
          }
          if (element.id === "left-match") {
            return 36
          }
          if (element.id === "right-match") {
            return 44
          }
          return 0
        }
      })
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
        configurable: true,
        get() {
          const element = this as HTMLElement
          if (element.classList.contains("epub-dom-section")) {
            return 784
          }
          return (element as HTMLElement).offsetHeight
        }
      })
      Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
        configurable: true,
        value() {
          const element = this as HTMLElement
          const sectionId = element.getAttribute("data-section-id")
          const spreadSlot = element.getAttribute("data-spread-slot")

          if (spreadSlot === "left") {
            return {
              x: 0,
              y: 8,
              left: 0,
              top: 8,
              right: 588,
              bottom: 792,
              width: 588,
              height: 784,
              toJSON() {
                return this
              }
            }
          }

          if (spreadSlot === "right") {
            return {
              x: 612,
              y: 8,
              left: 612,
              top: 8,
              right: 1200,
              bottom: 792,
              width: 588,
              height: 784,
              toJSON() {
                return this
              }
            }
          }

          if (sectionId === "section-2") {
            return {
              x: 0,
              y: 8,
              left: 0,
              top: 8,
              right: 588,
              bottom: 792,
              width: 588,
              height: 784,
              toJSON() {
                return this
              }
            }
          }

          if (sectionId === "section-3") {
            return {
              x: 612,
              y: 8,
              left: 612,
              top: 8,
              right: 1200,
              bottom: 792,
              width: 588,
              height: 784,
              toJSON() {
                return this
              }
            }
          }

          if (element.id === "left-match") {
            return {
              x: 40,
              y: 120,
              left: 40,
              top: 120,
              right: 260,
              bottom: 156,
              width: 220,
              height: 36,
              toJSON() {
                return this
              }
            }
          }

          if (element.id === "right-match") {
            return {
              x: 700,
              y: 220,
              left: 700,
              top: 220,
              right: 940,
              bottom: 264,
              width: 240,
              height: 44,
              toJSON() {
                return this
              }
            }
          }

          return originalGetBoundingClientRect?.value?.call(this) ?? {
            x: 0,
            y: 0,
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            width: 0,
            height: 0,
            toJSON() {
              return this
            }
          }
        }
      })

      const container = createContainer()
      const reader = new EpubReader({
        container,
        mode: "paginated"
      })
      const firstSection = createFixedLayoutSection({
        id: "section-1",
        href: "OPS/fxl-1.xhtml"
      })
      const secondSection = createFixedLayoutSection({
        id: "section-2",
        href: "OPS/fxl-2.xhtml",
        blocks: [
          {
            id: "left-match",
            kind: "text",
            inlines: [{ kind: "text", text: "Left spread query target" }]
          }
        ]
      })
      const thirdSection = createFixedLayoutSection({
        id: "section-3",
        href: "OPS/fxl-3.xhtml",
        blocks: [
          {
            id: "right-match",
            kind: "text",
            inlines: [{ kind: "text", text: "Right spread query target" }]
          }
        ]
      })
      const book: Book = {
        metadata: {
          title: "FXL Search Spread",
          identifier: "urn:uuid:fxl-search-spread",
          renditionLayout: "pre-paginated",
          renditionSpread: "auto"
        },
        manifest: [],
        spine: [
          { idref: "item-1", href: firstSection.href, linear: true },
          { idref: "item-2", href: secondSection.href, linear: true },
          { idref: "item-3", href: thirdSection.href, linear: true }
        ],
        toc: [],
        sections: [firstSection, secondSection, thirdSection]
      }

      ;(reader as unknown as { book: Book }).book = book
      ;(
        reader as unknown as {
          chapterRenderInputs: Array<ReturnType<typeof createSharedChapterRenderInput>>
        }
      ).chapterRenderInputs = [
        createSharedChapterRenderInput({
          href: firstSection.href,
          content: `<?xml version="1.0"?><html><body><p>First page</p></body></html>`
        }),
        createSharedChapterRenderInput({
          href: secondSection.href,
          content: `<?xml version="1.0"?><html><body><p id="left-match">Left spread query target</p></body></html>`
        }),
        createSharedChapterRenderInput({
          href: thirdSection.href,
          content: `<?xml version="1.0"?><html><body><p id="right-match">Right spread query target</p></body></html>`
        })
      ]

      await reader.render()

      const rightResults = await reader.search("Right spread query")
      expect(rightResults).toHaveLength(1)
      await reader.goToSearchResult(rightResults[0]!)
      expect(reader.getPaginationInfo()).toEqual({
        currentPage: 2,
        totalPages: 2
      })
      expect(container.scrollTop).toBe(0)
      expect(reader.getCurrentLocation()?.spineIndex).toBe(2)
      expect(reader.getCurrentLocation()?.blockId).toBe("right-match")
      expect(reader.getCurrentLocation()?.progressInSection ?? 0).toBeGreaterThan(0.27)
      expect(reader.getCurrentLocation()?.progressInSection ?? 0).toBeLessThan(0.31)

      const leftResults = await reader.search("Left spread query")
      expect(leftResults).toHaveLength(1)
      await reader.goToSearchResult(leftResults[0]!)
      expect(reader.getPaginationInfo()).toEqual({
        currentPage: 2,
        totalPages: 2
      })
      expect(container.scrollTop).toBe(0)
      expect(reader.getCurrentLocation()?.spineIndex).toBe(1)
      expect(reader.getCurrentLocation()?.blockId).toBe("left-match")
      expect(reader.getCurrentLocation()?.progressInSection ?? 0).toBeGreaterThan(0.14)
      expect(reader.getCurrentLocation()?.progressInSection ?? 0).toBeLessThan(0.18)

      reader.setAnnotations([
        {
          id: "annotation-hidden",
          publicationId: "identifier:urn:uuid:fxl-search-spread",
          locator: {
            spineIndex: 0,
            blockId: "missing-first",
            progressInSection: 0.1
          },
          quote: "Hidden",
          createdAt: "2026-04-18T14:00:00.000Z",
          updatedAt: "2026-04-18T14:00:00.000Z"
        },
        {
          id: "annotation-left",
          publicationId: "identifier:urn:uuid:fxl-search-spread",
          locator: {
            spineIndex: 1,
            blockId: "left-match",
            progressInSection: 0.1
          },
          quote: "Left spread query target",
          createdAt: "2026-04-18T14:01:00.000Z",
          updatedAt: "2026-04-18T14:01:00.000Z"
        },
        {
          id: "annotation-right",
          publicationId: "identifier:urn:uuid:fxl-search-spread",
          locator: {
            spineIndex: 2,
            blockId: "right-match",
            progressInSection: 0.2
          },
          quote: "Right spread query target",
          createdAt: "2026-04-18T14:02:00.000Z",
          updatedAt: "2026-04-18T14:02:00.000Z"
        }
      ])

      const snapshots = reader.getAnnotationViewportSnapshots()
      const hiddenSnapshot = snapshots.find((snapshot) => snapshot.annotation.id === "annotation-hidden")
      const leftSnapshot = snapshots.find((snapshot) => snapshot.annotation.id === "annotation-left")
      const rightSnapshot = snapshots.find((snapshot) => snapshot.annotation.id === "annotation-right")

      expect(hiddenSnapshot?.visible).toBe(false)
      expect(hiddenSnapshot?.rects).toEqual([])
      expect(hiddenSnapshot?.resolvedLocator?.spineIndex).toBe(0)

      expect(leftSnapshot?.visible).toBe(true)
      expect(leftSnapshot?.resolvedLocator?.blockId).toBe("left-match")
      expect(leftSnapshot?.rects).toEqual([
        {
          x: 40,
          y: 120,
          width: 220,
          height: 36
        }
      ])

      expect(rightSnapshot?.visible).toBe(true)
      expect(rightSnapshot?.resolvedLocator?.blockId).toBe("right-match")
      expect(rightSnapshot?.rects).toEqual([
        {
          x: 700,
          y: 220,
          width: 240,
          height: 44
        }
      ])
    } finally {
      if (originalOffsetHeight) {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight)
      }
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight)
      }
      if (originalGetBoundingClientRect) {
        Object.defineProperty(
          HTMLElement.prototype,
          "getBoundingClientRect",
          originalGetBoundingClientRect
        )
      }
    }
  })

  it("maps locators, viewport points, and dom hit tests across paired spread slots", async () => {
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight")
    const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight")
    const originalGetBoundingClientRect = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "getBoundingClientRect"
    )

    try {
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get() {
          const element = this as HTMLElement
          if (element.classList.contains("epub-dom-section")) {
            return 784
          }
          if (element.id === "hero-image") {
            return 320
          }
          if (element.id === "details-block") {
            return 40
          }
          if (element.id === "details-link") {
            return 18
          }
          return 0
        }
      })
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
        configurable: true,
        get() {
          const element = this as HTMLElement
          if (element.classList.contains("epub-dom-section")) {
            return 784
          }
          return (element as HTMLElement).offsetHeight
        }
      })
      Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
        configurable: true,
        value() {
          const element = this as HTMLElement
          const sectionId = element.getAttribute("data-section-id")
          const spreadSlot = element.getAttribute("data-spread-slot")

          if (spreadSlot === "left") {
            return {
              x: 0,
              y: 8,
              left: 0,
              top: 8,
              right: 588,
              bottom: 792,
              width: 588,
              height: 784,
              toJSON() {
                return this
              }
            }
          }

          if (spreadSlot === "right") {
            return {
              x: 612,
              y: 8,
              left: 612,
              top: 8,
              right: 1200,
              bottom: 792,
              width: 588,
              height: 784,
              toJSON() {
                return this
              }
            }
          }

          if (sectionId === "section-2") {
            return {
              x: 0,
              y: 8,
              left: 0,
              top: 8,
              right: 588,
              bottom: 792,
              width: 588,
              height: 784,
              toJSON() {
                return this
              }
            }
          }

          if (sectionId === "section-3") {
            return {
              x: 612,
              y: 8,
              left: 612,
              top: 8,
              right: 1200,
              bottom: 792,
              width: 588,
              height: 784,
              toJSON() {
                return this
              }
            }
          }

          if (element.id === "details-block") {
            return {
              x: 36,
              y: 96,
              left: 36,
              top: 96,
              right: 276,
              bottom: 136,
              width: 240,
              height: 40,
              toJSON() {
                return this
              }
            }
          }

          if (element.id === "details-link") {
            return {
              x: 44,
              y: 104,
              left: 44,
              top: 104,
              right: 164,
              bottom: 122,
              width: 120,
              height: 18,
              toJSON() {
                return this
              }
            }
          }

          if (element.id === "hero-image") {
            return {
              x: 700,
              y: 180,
              left: 700,
              top: 180,
              right: 960,
              bottom: 500,
              width: 260,
              height: 320,
              toJSON() {
                return this
              }
            }
          }

          return originalGetBoundingClientRect?.value?.call(this) ?? {
            x: 0,
            y: 0,
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            width: 0,
            height: 0,
            toJSON() {
              return this
            }
          }
        }
      })

      const container = createContainer()
      const reader = new EpubReader({
        container,
        mode: "paginated"
      })
      const firstSection = createFixedLayoutSection({
        id: "section-1",
        href: "OPS/fxl-1.xhtml"
      })
      const secondSection = createFixedLayoutSection({
        id: "section-2",
        href: "OPS/fxl-2.xhtml"
      })
      const thirdSection = createFixedLayoutSection({
        id: "section-3",
        href: "OPS/fxl-3.xhtml"
      })
      const book: Book = {
        metadata: {
          title: "FXL Geometry Spread",
          renditionLayout: "pre-paginated",
          renditionSpread: "auto"
        },
        manifest: [],
        spine: [
          { idref: "item-1", href: firstSection.href, linear: true },
          { idref: "item-2", href: secondSection.href, linear: true },
          { idref: "item-3", href: thirdSection.href, linear: true }
        ],
        toc: [],
        sections: [firstSection, secondSection, thirdSection]
      }

      ;(reader as unknown as { book: Book }).book = book
      ;(
        reader as unknown as {
          chapterRenderInputs: Array<ReturnType<typeof createSharedChapterRenderInput>>
        }
      ).chapterRenderInputs = [
        createSharedChapterRenderInput({
          href: firstSection.href,
          content: `<?xml version="1.0"?><html><body><p>First page</p></body></html>`
        }),
        createSharedChapterRenderInput({
          href: secondSection.href,
          content: `<?xml version="1.0"?><html><body><p id="details-block"><a id="details-link" href="OPS/fxl-1.xhtml#back">Back</a></p></body></html>`
        }),
        createSharedChapterRenderInput({
          href: thirdSection.href,
          content: `<?xml version="1.0"?><html><body><img id="hero-image" src="OPS/images/hero.png" alt="Hero" /></body></html>`
        })
      ]

      await reader.render()
      await reader.goToPage(2)

      expect(
        reader.mapLocatorToViewport({
          spineIndex: 2,
          blockId: "hero-image",
          progressInSection: 0
        })
      ).toEqual([
        {
          x: 700,
          y: 180,
          width: 260,
          height: 320
        }
      ])

      expect(
        reader.mapViewportToLocator({
          x: 710,
          y: 190
        })
      ).toEqual({
        spineIndex: 2,
        blockId: "hero-image",
        progressInSection: 0.23214285714285715
      })

      expect(reader.hitTest({ x: 710, y: 190 })).toEqual({
        kind: "image",
        rect: {
          x: 700,
          y: 180,
          width: 260,
          height: 320
        },
        sectionId: "section-3",
        blockId: "hero-image",
        src: "OPS/OPS/images/hero.png",
        alt: "Hero",
        locator: {
          spineIndex: 2,
          blockId: "hero-image",
          progressInSection: 0.23214285714285715
        }
      })

      expect(reader.hitTest({ x: 50, y: 110 })).toEqual({
        kind: "link",
        rect: {
          x: 44,
          y: 104,
          width: 120,
          height: 18
        },
        sectionId: "section-2",
        blockId: "details-link",
        href: "OPS/fxl-1.xhtml#back",
        locator: {
          spineIndex: 1,
          blockId: "details-link",
          progressInSection: 0.13010204081632654
        },
        text: "Back"
      })
    } finally {
      if (originalOffsetHeight) {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight)
      }
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight)
      }
      if (originalGetBoundingClientRect) {
        Object.defineProperty(
          HTMLElement.prototype,
          "getBoundingClientRect",
          originalGetBoundingClientRect
        )
      }
    }
  })
})
