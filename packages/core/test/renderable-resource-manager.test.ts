import { afterEach, describe, expect, it, vi } from "vitest"
import { RenderableResourceManager } from "../src/runtime/renderable-resource-manager"

describe("RenderableResourceManager", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("marks canvas resources as ready and notifies the canvas callback when binaries resolve", async () => {
    const originalCreateObjectUrl = URL.createObjectURL
    const originalRevokeObjectUrl = URL.revokeObjectURL
    const createObjectUrl = vi.fn(() => "blob:canvas-resource")
    const revokeObjectUrl = vi.fn(() => undefined)
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl
    })

    let canvasResolvedCount = 0
    const manager = new RenderableResourceManager({
      getContainer: () => null,
      readBinary: async () => new Uint8Array([1, 2, 3]),
      shouldTrackDomLayoutChanges: () => false,
      onCanvasResourceResolved: () => {
        canvasResolvedCount += 1
      },
      onDomLayoutChange: () => undefined
    })

    expect(manager.resolveUrl("OPS/image.png", "canvas")).toBe("OPS/image.png")
    await Promise.resolve()
    await Promise.resolve()

    expect(manager.isReady("OPS/image.png")).toBe(true)
    expect(canvasResolvedCount).toBe(1)

    manager.revokeAll()
    expect(createObjectUrl).toHaveBeenCalledTimes(1)
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:canvas-resource")

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: originalCreateObjectUrl
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: originalRevokeObjectUrl
    })
  })

  it("patches rendered dom resources and triggers dom layout callbacks when needed", async () => {
    const originalCreateObjectUrl = URL.createObjectURL
    const originalRevokeObjectUrl = URL.revokeObjectURL
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:dom-resource")
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(() => undefined)
    })

    const container = document.createElement("div")
    container.innerHTML = `
      <div class="epub-dom-section">
        <style data-epub-dom-source="OPS/pattern.css">.demo { background-image: url(OPS/pattern.png) }</style>
      </div>
    `

    let domLayoutChangeCount = 0
    const manager = new RenderableResourceManager({
      getContainer: () => container,
      readBinary: async () => new Uint8Array([4, 5, 6]),
      shouldTrackDomLayoutChanges: () => true,
      onCanvasResourceResolved: () => undefined,
      onDomLayoutChange: () => {
        domLayoutChangeCount += 1
      }
    })

    manager.resolveUrl("OPS/pattern.png", "dom")
    await Promise.resolve()
    await Promise.resolve()

    const patchedSourceStyle = container.querySelector<HTMLStyleElement>(
      "style[data-epub-dom-source]"
    )

    expect(patchedSourceStyle?.textContent).toContain("blob:dom-resource")
    expect(domLayoutChangeCount).toBeGreaterThan(0)

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: originalCreateObjectUrl
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: originalRevokeObjectUrl
    })
  })

  it("skips missing resources without invoking binary reads", async () => {
    const readBinary = vi.fn(async () => new Uint8Array([7, 8, 9]))
    const manager = new RenderableResourceManager({
      getContainer: () => null,
      readBinary,
      hasBinary: () => false,
      shouldTrackDomLayoutChanges: () => false,
      onCanvasResourceResolved: () => undefined,
      onDomLayoutChange: () => undefined
    })

    expect(manager.resolveUrl("OPS/missing.png", "dom")).toBe("OPS/missing.png")
    await Promise.resolve()
    expect(readBinary).not.toHaveBeenCalled()
    expect(manager.isReady("OPS/missing.png")).toBe(false)
  })
})
