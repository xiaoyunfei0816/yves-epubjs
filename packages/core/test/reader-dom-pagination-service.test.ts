import { describe, expect, it } from "vitest"
import type { SectionDocument } from "../src/model/types"
import {
  ReaderDomPaginationService,
  collectPaginatedDomReadableLineBands,
  measurePaginatedDomPageOffsets
} from "../src/runtime/reader-dom-pagination-service"
import type { ReaderPage } from "../src/runtime/paginated-render-plan"

describe("ReaderDomPaginationService", () => {
  it("positions a paginated dom section inside its viewport", () => {
    const service = new ReaderDomPaginationService()
    const viewport = document.createElement("div")
    viewport.dataset.pageViewport = "true"
    const sectionElement = document.createElement("section")
    viewport.appendChild(sectionElement)
    setElementBox(sectionElement, {
      top: 0,
      height: 640,
      scrollHeight: 640,
      offsetHeight: 640
    })
    const pages: ReaderPage[] = [
      createPage(1, 1, 0),
      createPage(2, 2, 320)
    ]

    service.positionPaginatedDomSection({
      sectionElement,
      page: pages[1]!,
      pageHeight: 320,
      pages
    })

    expect(viewport.style.height).toBe("320px")
    expect(sectionElement.style.transform).toBe("translateY(-320px)")
    expect(sectionElement.style.position).toBe("relative")
  })

  it("syncs measured dom pages from rendered block positions", () => {
    const service = new ReaderDomPaginationService()
    const section = createSection()
    const container = document.createElement("div")
    const sectionElement = document.createElement("section")
    sectionElement.className = "epub-dom-section"
    sectionElement.dataset.sectionId = section.id
    container.appendChild(sectionElement)
    setElementBox(sectionElement, {
      top: 0,
      height: 900,
      scrollHeight: 900,
      offsetHeight: 900
    })

    const first = document.createElement("p")
    first.dataset.readerBlockId = "text-1"
    first.textContent = "First"
    setElementBox(first, { top: 20, height: 20 })
    const second = document.createElement("p")
    second.dataset.readerBlockId = "text-2"
    second.textContent = "Second"
    setElementBox(second, { top: 650, height: 20 })
    sectionElement.append(first, second)

    const result = service.syncMeasuredPaginatedDomPages({
      container,
      section,
      currentSectionIndex: 0,
      currentPageNumber: 1,
      pages: [createPage(1, 1, 0)],
      pageHeight: 300,
      locator: null
    })

    expect(result?.pages).toHaveLength(3)
    expect(result?.pages[0]?.blocks.map((slice) => slice.block.id)).toEqual([
      "text-1"
    ])
    expect(result?.pages[2]?.blocks.map((slice) => slice.block.id)).toEqual([
      "text-2"
    ])
    expect(result?.sectionEstimatedHeight).toBe(900)
  })

  it("does not count inline images as independent media bands", () => {
    const sectionElement = document.createElement("section")
    sectionElement.className = "epub-dom-section"
    setElementBox(sectionElement, {
      top: 0,
      height: 320,
      scrollHeight: 320,
      offsetHeight: 320
    })
    sectionElement.innerHTML = `
      <p>Alpha<a class="footnote" href="#note-1"><img id="note" src="note.png"></a>Omega</p>
      <p><img id="plate" src="plate.png"></p>
    `
    const note = sectionElement.querySelector<HTMLElement>("#note")!
    const plate = sectionElement.querySelector<HTMLElement>("#plate")!
    setElementBox(note, { top: 24, height: 16 })
    setElementBox(plate, { top: 140, height: 120 })

    expect(collectPaginatedDomReadableLineBands(sectionElement)).toEqual([
      {
        top: 140,
        bottom: 260
      }
    ])
  })

  it("does not create a trailing tiny page from section height remainder", () => {
    const sectionElement = document.createElement("section")
    sectionElement.className = "epub-dom-section"
    setElementBox(sectionElement, {
      top: 0,
      height: 862,
      scrollHeight: 862,
      offsetHeight: 862
    })

    expect(measurePaginatedDomPageOffsets(sectionElement, 430)).toEqual([
      0,
      430
    ])
  })
})

function createSection(): SectionDocument {
  return {
    id: "section-1",
    href: "section-1.xhtml",
    anchors: {},
    blocks: [
      {
        id: "text-1",
        kind: "text",
        inlines: [{ kind: "text", text: "First" }]
      },
      {
        id: "text-2",
        kind: "text",
        inlines: [{ kind: "text", text: "Second" }]
      }
    ]
  }
}

function createPage(
  pageNumber: number,
  pageNumberInSection: number,
  offsetInSection: number
): ReaderPage {
  return {
    pageNumber,
    pageNumberInSection,
    totalPagesInSection: 2,
    spineIndex: 0,
    sectionId: "section-1",
    sectionHref: "section-1.xhtml",
    offsetInSection,
    blocks: []
  }
}

function setElementBox(
  element: HTMLElement,
  input: {
    top: number
    height: number
    scrollHeight?: number
    offsetHeight?: number
  }
): void {
  if (input.scrollHeight !== undefined) {
    Object.defineProperty(element, "scrollHeight", {
      configurable: true,
      value: input.scrollHeight
    })
  }
  if (input.offsetHeight !== undefined) {
    Object.defineProperty(element, "offsetHeight", {
      configurable: true,
      value: input.offsetHeight
    })
  }
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: input.top,
      left: 0,
      top: input.top,
      right: 100,
      bottom: input.top + input.height,
      width: 100,
      height: input.height,
      toJSON() {
        return this
      }
    })
  })
}
