import { describe, expect, it } from "vitest"
import { applyDomDecorations, clearDomDecorations } from "../src/runtime/dom-decoration"

describe("dom decorations", () => {
  it("applies highlight classes to anchor and block targets", () => {
    const container = document.createElement("div")
    container.innerHTML = `
      <div class="epub-dom-section" data-section-id="section-1">
        <h2 id="details">Details</h2>
        <p id="text-2">Body</p>
      </div>
    `
    const sectionElement = container.querySelector<HTMLElement>(".epub-dom-section")
    expect(sectionElement).toBeTruthy()

    applyDomDecorations({
      container,
      sectionElement: sectionElement!,
      decorations: [
        {
          id: "highlight-1",
          group: "manual",
          locator: {
            spineIndex: 0,
            anchorId: "details",
            progressInSection: 0.1
          },
          style: "highlight"
        },
        {
          id: "search-1",
          group: "search-results",
          locator: {
            spineIndex: 0,
            blockId: "text-2",
            progressInSection: 0.4
          },
          style: "search-hit"
        }
      ]
    })

    expect(container.querySelector("style[data-epub-dom-decorations='true']")).toBeTruthy()
    expect(container.querySelector("#details")?.classList.contains("epub-dom-decoration-highlight")).toBe(
      true
    )
    expect(container.querySelector("#text-2")?.classList.contains("epub-dom-decoration-search-hit")).toBe(
      true
    )

    clearDomDecorations(container)

    expect(container.querySelector("#details")?.classList.contains("epub-dom-decoration-highlight")).toBe(
      false
    )
    expect(container.querySelector("#text-2")?.classList.contains("epub-dom-decoration-search-hit")).toBe(
      false
    )
  })

  it("preserves decorations across multiple spread sections", () => {
    const container = document.createElement("div")
    container.innerHTML = `
      <div class="epub-dom-spread">
        <div class="epub-dom-spread-slot" data-spread-slot="left">
          <div class="epub-dom-section" data-section-id="section-1">
            <p id="left-target">Left</p>
          </div>
        </div>
        <div class="epub-dom-spread-slot" data-spread-slot="right">
          <div class="epub-dom-section" data-section-id="section-2">
            <p id="right-target">Right</p>
          </div>
        </div>
      </div>
    `
    const leftSection = container.querySelector<HTMLElement>(
      '.epub-dom-section[data-section-id="section-1"]'
    )
    const rightSection = container.querySelector<HTMLElement>(
      '.epub-dom-section[data-section-id="section-2"]'
    )
    expect(leftSection).toBeTruthy()
    expect(rightSection).toBeTruthy()

    applyDomDecorations({
      container,
      sectionElement: leftSection!,
      decorations: [
        {
          id: "search-left",
          group: "search-results",
          locator: {
            spineIndex: 0,
            blockId: "left-target",
            progressInSection: 0.2
          },
          style: "search-hit"
        }
      ]
    })
    applyDomDecorations({
      container,
      sectionElement: rightSection!,
      decorations: [
        {
          id: "annotation-right",
          group: "annotations",
          locator: {
            spineIndex: 1,
            blockId: "right-target",
            progressInSection: 0.5
          },
          style: "highlight"
        }
      ]
    })

    expect(container.querySelector("#left-target")?.classList.contains("epub-dom-decoration-search-hit")).toBe(
      true
    )
    expect(container.querySelector("#right-target")?.classList.contains("epub-dom-decoration-highlight")).toBe(
      true
    )
  })

  it("applies underline decorations and reserved hint classes", () => {
    const container = document.createElement("div")
    container.innerHTML = `
      <div class="epub-dom-section" data-section-id="section-1">
        <p id="annotated-target">Annotated text</p>
      </div>
    `
    const sectionElement = container.querySelector<HTMLElement>(".epub-dom-section")
    expect(sectionElement).toBeTruthy()

    applyDomDecorations({
      container,
      sectionElement: sectionElement!,
      decorations: [
        {
          id: "underline-1",
          group: "annotations",
          locator: {
            spineIndex: 0,
            blockId: "annotated-target",
            progressInSection: 0.4
          },
          style: "underline",
          extras: {
            renderHint: "note-icon",
            label: "Inline note"
          }
        }
      ]
    })

    const target = container.querySelector<HTMLElement>("#annotated-target")
    expect(target?.classList.contains("epub-dom-decoration-underline")).toBe(true)
    expect(target?.classList.contains("epub-dom-decoration-hint-note-icon")).toBe(true)
    expect(target?.dataset.epubDecorationLabel).toBe("Inline note")

    clearDomDecorations(container)

    expect(target?.classList.contains("epub-dom-decoration-underline")).toBe(false)
    expect(target?.classList.contains("epub-dom-decoration-hint-note-icon")).toBe(false)
    expect(target?.dataset.epubDecorationLabel).toBeUndefined()
  })
})
