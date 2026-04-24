import type { Book, SectionDocument } from "../../src/model/types"
import type { SharedChapterRenderInput } from "../../src/runtime/chapter-render-input"
import type { EpubReader } from "../../src/runtime/reader"

export function createReaderContainer(
  input: {
    width?: number
    height?: number
    scrollTop?: number
    scrollLeft?: number
    rect?: Partial<DOMRect>
  } = {}
): HTMLDivElement {
  const container = document.createElement("div")
  Object.defineProperty(container, "clientWidth", {
    configurable: true,
    value: input.width ?? 320
  })
  Object.defineProperty(container, "clientHeight", {
    configurable: true,
    value: input.height ?? 480
  })
  Object.defineProperty(container, "scrollTop", {
    configurable: true,
    writable: true,
    value: input.scrollTop ?? 0
  })
  Object.defineProperty(container, "scrollLeft", {
    configurable: true,
    writable: true,
    value: input.scrollLeft ?? 0
  })
  if (input.rect) {
    Object.defineProperty(container, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: input.rect?.x ?? 0,
        y: input.rect?.y ?? 0,
        left: input.rect?.left ?? input.rect?.x ?? 0,
        top: input.rect?.top ?? input.rect?.y ?? 0,
        right:
          input.rect?.right ??
          (input.rect?.left ?? input.rect?.x ?? 0) + (input.width ?? 320),
        bottom:
          input.rect?.bottom ??
          (input.rect?.top ?? input.rect?.y ?? 0) + (input.height ?? 480),
        width: input.rect?.width ?? input.width ?? 320,
        height: input.rect?.height ?? input.height ?? 480,
        toJSON() {
          return this
        }
      })
    })
  }
  document.body.appendChild(container)
  return container
}

export function createBookFromSections(input: {
  title: string
  sections: SectionDocument[]
  identifier?: string
}): Book {
  return {
    metadata: {
      title: input.title,
      ...(input.identifier ? { identifier: input.identifier } : {})
    },
    manifest: [],
    spine: input.sections.map((section, index) => ({
      idref: `item-${index + 1}`,
      href: section.href,
      linear: true
    })),
    toc: [],
    sections: input.sections
  }
}

export function installReaderBook(input: {
  reader: EpubReader
  book: Book
  chapterRenderInputs?: SharedChapterRenderInput[]
  sourceName?: string | null
}): void {
  const state = input.reader as unknown as {
    book: Book
    chapterRenderInputs?: SharedChapterRenderInput[]
    sourceName?: string | null
  }
  state.book = input.book
  if (input.chapterRenderInputs) {
    state.chapterRenderInputs = input.chapterRenderInputs
  }
  if (input.sourceName !== undefined) {
    state.sourceName = input.sourceName
  }
}
