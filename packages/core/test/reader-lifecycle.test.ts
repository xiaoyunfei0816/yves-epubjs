import { describe, expect, it, vi } from "vitest"
import { EpubReader } from "../src"

describe("EpubReader lifecycle", () => {
  it("removes container event listeners symmetrically on destroy", () => {
    const container = document.createElement("div")
    const addEventListenerSpy = vi.spyOn(container, "addEventListener")
    const removeEventListenerSpy = vi.spyOn(container, "removeEventListener")

    const reader = new EpubReader({
      container,
      mode: "paginated"
    })

    const addedHandlers = new Map<string, EventListenerOrEventListenerObject>()
    for (const [type, handler] of addEventListenerSpy.mock.calls) {
      if (
        (type === "scroll" || type === "click" || type === "keydown") &&
        handler
      ) {
        addedHandlers.set(type, handler)
      }
    }

    expect(addedHandlers.get("scroll")).toBeTruthy()
    expect(addedHandlers.get("click")).toBeTruthy()
    expect(addedHandlers.get("keydown")).toBeTruthy()

    reader.destroy()

    const removedHandlers = new Map<string, EventListenerOrEventListenerObject>()
    for (const [type, handler] of removeEventListenerSpy.mock.calls) {
      if (
        (type === "scroll" || type === "click" || type === "keydown") &&
        handler
      ) {
        removedHandlers.set(type, handler)
      }
    }

    expect(removedHandlers.get("scroll")).toBe(addedHandlers.get("scroll"))
    expect(removedHandlers.get("click")).toBe(addedHandlers.get("click"))
    expect(removedHandlers.get("keydown")).toBe(addedHandlers.get("keydown"))
  })
})
