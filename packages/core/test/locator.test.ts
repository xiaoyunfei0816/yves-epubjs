import { describe, expect, it } from "vitest"
import type { Book, SectionDocument } from "../src/model/types"
import { parseXhtmlDocument } from "../src/parser/xhtml-parser"
import {
  deserializeLocator,
  getLocatorPrecision,
  normalizeLocator,
  restoreLocator,
  serializeLocator
} from "../src/runtime/locator"

function createBook(sections: SectionDocument[]): Book {
  return {
    metadata: {
      title: "Locator Test"
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

describe("locator helpers", () => {
  it("normalizes locator fields into a stable contract", () => {
    const locator = normalizeLocator({
      spineIndex: 1.8,
      blockId: " text-2 ",
      anchorId: " later ",
      inlineOffset: 7.6,
      cfi: " epubcfi(/6/4[chap01]!/4/2/8) ",
      progressInSection: 1.3
    })

    expect(locator).toEqual({
      spineIndex: 1,
      blockId: "text-2",
      anchorId: "later",
      inlineOffset: 7,
      cfi: "epubcfi(/6/4[chap01]!/4/2/8)",
      progressInSection: 1
    })
    expect(getLocatorPrecision(locator)).toBe("cfi")
  })

  it("serializes locators with href context and restores them from JSON", () => {
    const section: SectionDocument = {
      id: "section-1",
      href: "OPS/chapter-1.xhtml",
      title: "Chapter 1",
      anchors: {},
      blocks: [
        {
          id: "text-1",
          kind: "text",
          inlines: [{ kind: "text", text: "Paragraph" }]
        }
      ]
    }
    const book = createBook([section])

    const serialized = serializeLocator({
      locator: {
        spineIndex: 0,
        blockId: "text-1",
        progressInSection: 0.25
      },
      book
    })

    expect(serialized).toEqual({
      spineIndex: 0,
      href: "OPS/chapter-1.xhtml",
      blockId: "text-1",
      progressInSection: 0.25
    })
    expect(deserializeLocator(JSON.stringify(serialized))).toEqual(serialized)
  })

  it("can generate a best-effort cfi for persisted locators when book context is available", () => {
    const section: SectionDocument = {
      id: "section-1",
      href: "OPS/chapter-1.xhtml",
      title: "Chapter 1",
      anchors: {
        intro: "text-1"
      },
      blocks: [
        {
          id: "text-1",
          kind: "text",
          inlines: [{ kind: "text", text: "Paragraph" }]
        }
      ]
    }
    const book = createBook([section])

    expect(
      serializeLocator({
        locator: {
          spineIndex: 0,
          blockId: "text-1",
          progressInSection: 0.25
        },
        book,
        generateCfi: true
      })
    ).toEqual({
      spineIndex: 0,
      href: "OPS/chapter-1.xhtml",
      blockId: "text-1",
      cfi: "epubcfi(/6/2!/2[text-1])",
      progressInSection: 0.25
    })
  })

  it("restores serialized locators by preferring anchor precision over stale progress", () => {
    const parsed = parseXhtmlDocument(
      `<?xml version="1.0"?>
      <html>
        <body>
          <p>Intro</p>
          <section id="later">
            <h2>Later</h2>
            <p>Target paragraph</p>
          </section>
        </body>
      </html>`,
      "OPS/chapter-1.xhtml"
    )
    const section: SectionDocument = {
      ...parsed,
      id: "section-1"
    }
    const book = createBook([section])

    const restored = restoreLocator({
      book,
      locator: {
        href: "./OPS/chapter-1.xhtml",
        anchorId: " later ",
        progressInSection: 0.1
      }
    })

    expect(restored).toEqual({
      spineIndex: 0,
      blockId: section.anchors.later,
      anchorId: "later",
      progressInSection: 0.5
    })
    expect(getLocatorPrecision(restored!)).toBe("anchor")
  })

  it("falls back to section progress when serialized block targets are no longer present", () => {
    const section: SectionDocument = {
      id: "section-1",
      href: "OPS/chapter-1.xhtml",
      title: "Chapter 1",
      anchors: {},
      blocks: [
        {
          id: "text-1",
          kind: "text",
          inlines: [{ kind: "text", text: "Paragraph" }]
        }
      ]
    }
    const book = createBook([section])

    expect(
      restoreLocator({
        book,
        locator: {
          href: "OPS/chapter-1.xhtml",
          blockId: "missing-block",
          progressInSection: 1.4
        }
      })
    ).toEqual({
      spineIndex: 0,
      progressInSection: 1
    })
  })

  it("restores cfi-only locators through anchor qualifiers without requiring href or block ids", () => {
    const parsed = parseXhtmlDocument(
      `<?xml version="1.0"?>
      <html>
        <body>
          <p>Intro</p>
          <section id="later">
            <h2>Later</h2>
            <p>Target paragraph</p>
          </section>
        </body>
      </html>`,
      "OPS/chapter-1.xhtml"
    )
    const section: SectionDocument = {
      ...parsed,
      id: "section-1"
    }
    const book = createBook([section])

    expect(
      restoreLocator({
        book,
        locator: {
          cfi: "epubcfi(/6/2!/4[later])"
        }
      })
    ).toEqual({
      spineIndex: 0,
      blockId: section.anchors.later,
      anchorId: "later",
      cfi: "epubcfi(/6/2!/4[later])",
      progressInSection: 0.5
    })
  })

  it("falls back from stale cfi qualifiers to block order when the cfi step still points at the right reading position", () => {
    const section: SectionDocument = {
      id: "section-1",
      href: "OPS/chapter-1.xhtml",
      title: "Chapter 1",
      anchors: {},
      blocks: [
        {
          id: "current-a",
          kind: "text",
          inlines: [{ kind: "text", text: "A" }]
        },
        {
          id: "current-b",
          kind: "text",
          inlines: [{ kind: "text", text: "B" }]
        }
      ]
    }
    const book = createBook([section])

    expect(
      restoreLocator({
        book,
        locator: {
          cfi: "epubcfi(/6/2!/4[old-generated-id])"
        }
      })
    ).toEqual({
      spineIndex: 0,
      blockId: "current-b",
      cfi: "epubcfi(/6/2!/4[old-generated-id])",
      progressInSection: 1
    })
  })
})
