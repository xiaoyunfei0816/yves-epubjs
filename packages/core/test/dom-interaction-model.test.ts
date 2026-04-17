import { describe, expect, it } from "vitest"
import type { Locator } from "../src/model/types"
import {
  resolveDomClickInteraction,
  SUPPORTED_DOM_INTERACTIONS
} from "../src/runtime/dom-interaction-model"

describe("dom interaction model", () => {
  it("defines the supported dom interaction contract explicitly", () => {
    expect(SUPPORTED_DOM_INTERACTIONS).toEqual([
      "link",
      "anchored-fragment",
      "chapter-progress"
    ])
  })

  it("resolves links before any locator fallback", () => {
    const link = document.createElement("a")
    link.setAttribute("href", "#details")
    link.textContent = "Jump"

    const interaction = resolveDomClickInteraction({
      target: link,
      resolveLocator: () => {
        throw new Error("link clicks should not resolve point locators")
      }
    })

    expect(interaction).toEqual({
      kind: "link",
      interaction: "link",
      href: "#details"
    })
  })

  it("classifies locator clicks as anchored fragments when block or anchor metadata exists", () => {
    const target = document.createElement("p")
    const locator: Locator = {
      spineIndex: 1,
      anchorId: "details",
      blockId: "text-4",
      progressInSection: 0.42
    }

    const interaction = resolveDomClickInteraction({
      target,
      resolveLocator: () => locator
    })

    expect(interaction).toEqual({
      kind: "locator",
      interaction: "anchored-fragment",
      locator
    })
  })

  it("classifies locator clicks without anchor metadata as chapter progress", () => {
    const target = document.createElement("div")
    const locator: Locator = {
      spineIndex: 1,
      progressInSection: 0.55
    }

    const interaction = resolveDomClickInteraction({
      target,
      resolveLocator: () => locator
    })

    expect(interaction).toEqual({
      kind: "locator",
      interaction: "chapter-progress",
      locator
    })
  })
})
