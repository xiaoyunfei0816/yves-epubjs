import { describe, expect, it, vi } from "vitest"
import type { Book, SectionDocument } from "../src/model/types"
import {
  createSharedChapterRenderInput,
  EpubReader,
  toCanvasChapterRenderInput
} from "../src"

function createContainer(): HTMLDivElement {
  const container = document.createElement("div")
  Object.defineProperty(container, "clientWidth", {
    configurable: true,
    value: 320
  })
  Object.defineProperty(container, "clientHeight", {
    configurable: true,
    value: 480
  })
  Object.defineProperty(container, "scrollTop", {
    configurable: true,
    writable: true,
    value: 0
  })
  document.body.appendChild(container)
  return container
}

function createDomLinkBook(href: string): {
  book: Book
  sharedInput: ReturnType<typeof createSharedChapterRenderInput>
} {
  const sharedInput = createSharedChapterRenderInput({
    href: "OPS/links.xhtml",
    content: `<?xml version="1.0" encoding="utf-8"?>
      <html xmlns="http://www.w3.org/1999/xhtml">
        <body>
          <section>
            <table>
              <tr>
                <td><a href="${href}">Open link</a></td>
              </tr>
            </table>
          </section>
        </body>
      </html>`
  })
  const section: SectionDocument = {
    ...toCanvasChapterRenderInput(sharedInput).section,
    id: "section-1"
  }

  return {
    sharedInput,
    book: {
      metadata: { title: "External Links" },
      manifest: [],
      spine: [{ idref: "item-1", href: section.href, linear: true }],
      toc: [],
      sections: [section]
    }
  }
}

describe("EpubReader external links", () => {
  it("activates safe external links through the host callback and event contract", async () => {
    const container = createContainer()
    const callback = vi.fn()
    const { book, sharedInput } = createDomLinkBook("https://example.com/docs")
    const reader = new EpubReader({
      container,
      mode: "scroll",
      onExternalLink: callback
    })
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
    ).chapterRenderInputs = [sharedInput]

    const activated: Array<{ href: string; scheme: string }> = []
    reader.on("externalLinkActivated", (payload) => {
      activated.push({
        href: payload.href,
        scheme: payload.scheme
      })
    })

    await reader.render()
    container.querySelector<HTMLAnchorElement>("a[href='https://example.com/docs']")?.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true
      })
    )
    await Promise.resolve()

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        href: "https://example.com/docs",
        scheme: "https",
        source: "dom"
      })
    )
    expect(activated).toEqual([
      {
        href: "https://example.com/docs",
        scheme: "https"
      }
    ])
  })

  it("blocks unsafe external schemes without invoking the host callback", async () => {
    const container = createContainer()
    const callback = vi.fn()
    const { book, sharedInput } = createDomLinkBook("javascript:alert(1)")
    const reader = new EpubReader({
      container,
      mode: "scroll",
      onExternalLink: callback
    })
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
    ).chapterRenderInputs = [sharedInput]

    const blocked: Array<{ href: string; scheme: string; reason: string }> = []
    reader.on("externalLinkBlocked", (payload) => {
      blocked.push(payload)
    })

    await reader.render()
    container
      .querySelector<HTMLAnchorElement>("a[href='javascript:alert(1)']")
      ?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true
        })
      )
    await Promise.resolve()

    expect(callback).not.toHaveBeenCalled()
    expect(blocked).toEqual([
      {
        href: "javascript:alert(1)",
        scheme: "javascript",
        reason: "unsafe-scheme"
      }
    ])
  })
})
