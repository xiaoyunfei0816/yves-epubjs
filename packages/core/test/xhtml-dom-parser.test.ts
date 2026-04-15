import { describe, expect, it } from "vitest"
import {
  parseXhtmlDomDocument
} from "../src/parser/xhtml-dom-parser"
import {
  findHtmlElementsByTagName,
  getHtmlElementAttribute,
  getHtmlNodeTextContent
} from "../src/parser/html-dom-adapter"

describe("parseXhtmlDomDocument", () => {
  it("builds a DOM-backed chapter document with body and metadata", () => {
    const parsed = parseXhtmlDomDocument(`<?xml version="1.0" encoding="UTF-8"?>
      <html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
        <head><title>Chapter 1</title></head>
        <body>
          <section id="chapter-1">
            <p>Hello <span class="accent">reader</span>.</p>
          </section>
        </body>
      </html>`)

    expect(parsed.title).toBe("Chapter 1")
    expect(parsed.lang).toBe("en")
    expect(parsed.htmlElement?.name).toBe("html")
    expect(parsed.headElement?.name).toBe("head")
    expect(parsed.bodyElement?.name).toBe("body")
  })

  it("preserves body descendants, attribute access, and text order", () => {
    const parsed = parseXhtmlDomDocument(`
      <html>
        <body>
          <figure id="fig-1">
            <img src="images/cover.png" alt="Cover" />
            <figcaption>Cover image</figcaption>
          </figure>
        </body>
      </html>
    `)

    expect(parsed.bodyElement).toBeTruthy()

    const figures = parsed.bodyElement ? findHtmlElementsByTagName(parsed.bodyElement, "figure") : []
    const images = parsed.bodyElement ? findHtmlElementsByTagName(parsed.bodyElement, "img") : []
    const captions = parsed.bodyElement ? findHtmlElementsByTagName(parsed.bodyElement, "figcaption") : []

    expect(figures).toHaveLength(1)
    expect(figures[0] && getHtmlElementAttribute(figures[0], "id")).toBe("fig-1")
    expect(images[0] && getHtmlElementAttribute(images[0], "src")).toBe("images/cover.png")
    expect(captions[0] && getHtmlNodeTextContent(captions[0])).toBe("Cover image")
  })
})
