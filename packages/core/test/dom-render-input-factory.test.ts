import { describe, expect, it } from "vitest"
import type { Book, SectionDocument } from "../src/model/types"
import { parseCssStyleSheet } from "../src/parser/css-ast-adapter"
import { parseXhtmlDocument } from "../src/parser/xhtml-parser"
import { createSharedChapterRenderInput } from "../src/runtime/chapter-render-input"
import { createDomChapterRenderInput } from "../src/runtime/dom-render-input-factory"

const THEME = {
  background: "#fffaf0",
  color: "#1f2328"
}

const TYPOGRAPHY = {
  fontSize: 18,
  lineHeight: 1.6,
  paragraphSpacing: 12
}

describe("dom render input factory", () => {
  it("resolves DOM resource attributes and stylesheet urls", () => {
    const section = createSection(
      `<?xml version="1.0"?>
      <html>
        <body>
          <p>
            <img src="images/photo.png" style="background-image: url('images/inline-bg.png')">
          </p>
        </body>
      </html>`,
      "section-1",
      "OPS/chapter.xhtml"
    )
    const input = createSharedChapterRenderInput({
      href: section.href,
      content: `<?xml version="1.0"?>
      <html>
        <body>
          <p>
            <img src="images/photo.png" style="background-image: url('images/inline-bg.png')">
          </p>
        </body>
      </html>`,
      linkedStyleSheets: [
        {
          href: "OPS/styles/book.css",
          mediaType: "text/css",
          text: "body { background-image: url('../images/paper.png'); }",
          ast: parseCssStyleSheet("body { background-image: url('../images/paper.png'); }")
        }
      ]
    })

    const renderInput = createDomChapterRenderInput({
      book: null,
      section,
      input,
      theme: THEME,
      typography: TYPOGRAPHY,
      fontFamily: "serif",
      resolveDomResourceUrl: (path) => `asset:${path}`
    })

    expect(renderInput.linkedStyleSheets?.[0]?.text).toContain(
      "url('asset:OPS/images/paper.png')"
    )
    expect(
      renderInput.resolveAttributeValue?.({
        tagName: "img",
        attributeName: "src",
        value: "images/photo.png"
      })
    ).toBe("asset:OPS/images/photo.png")
    expect(
      renderInput.resolveAttributeValue?.({
        tagName: "img",
        attributeName: "style",
        value: "background-image: url('images/inline-bg.png')"
      })
    ).toContain("url('asset:OPS/images/inline-bg.png')")
  })

  it("prefers metadata cover images for cover sections", () => {
    const section: SectionDocument = {
      ...createSection(
        `<?xml version="1.0"?>
        <html><body><p>Cover</p></body></html>`,
        "cover-section",
        "OPS/cover.xhtml"
      ),
      presentationRole: "cover"
    }
    const input = createSharedChapterRenderInput({
      href: section.href,
      content: `<?xml version="1.0"?><html><body><p>Cover</p></body></html>`
    })
    const book: Book = {
      metadata: {
        title: "Factory Book",
        coverImageHref: "OPS/images/cover.jpg"
      },
      manifest: [],
      spine: [],
      toc: [],
      sections: [section]
    }

    const renderInput = createDomChapterRenderInput({
      book,
      section,
      input,
      theme: THEME,
      typography: TYPOGRAPHY,
      fontFamily: "serif",
      resolveDomResourceUrl: (path) => `asset:${path}`
    })

    expect(renderInput.presentationImageSrc).toBe("asset:OPS/images/cover.jpg")
    expect(renderInput.presentationImageAlt).toBe("Factory Book")
  })

  it("uses a single inline image for image-page sections", () => {
    const content = `<?xml version="1.0"?>
      <html>
        <body>
          <p><img src="images/plate.png" alt="Plate"></p>
        </body>
      </html>`
    const section: SectionDocument = {
      ...createSection(content, "image-page", "OPS/plate.xhtml"),
      presentationRole: "image-page"
    }
    const input = createSharedChapterRenderInput({
      href: section.href,
      content
    })

    const renderInput = createDomChapterRenderInput({
      book: null,
      section,
      input,
      theme: THEME,
      typography: TYPOGRAPHY,
      fontFamily: "serif",
      resolveDomResourceUrl: (path) => `asset:${path}`
    })

    expect(renderInput.presentationImageSrc).toBe("asset:OPS/images/plate.png")
    expect(renderInput.presentationImageAlt).toBe("Plate")
  })
})

function createSection(content: string, id: string, href: string): SectionDocument {
  return {
    ...parseXhtmlDocument(content, href),
    id
  }
}
