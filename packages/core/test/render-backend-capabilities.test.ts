import { describe, expect, it } from "vitest"
import { resolveRenderBackendCapabilities } from "../src/runtime/render-backend-capabilities"

describe("render backend capabilities", () => {
  it("describes canvas paginated chapters as project-laid paginated pages", () => {
    expect(
      resolveRenderBackendCapabilities({
        backend: "canvas",
        mode: "paginated"
      })
    ).toEqual({
      layoutAuthority: "project-layout",
      geometrySource: "interaction-map",
      interactionModel: "canvas-hit-test",
      flowModel: "paginated-pages"
    })
  })

  it("describes canvas scroll chapters as project-laid sliced surfaces", () => {
    expect(
      resolveRenderBackendCapabilities({
        backend: "canvas",
        mode: "scroll"
      })
    ).toEqual({
      layoutAuthority: "project-layout",
      geometrySource: "interaction-map",
      interactionModel: "canvas-hit-test",
      flowModel: "scroll-slices"
    })
  })

  it("describes dom paginated chapters as browser-laid content with shared page flow", () => {
    expect(
      resolveRenderBackendCapabilities({
        backend: "dom",
        mode: "paginated"
      })
    ).toEqual({
      layoutAuthority: "browser-layout",
      geometrySource: "dom-geometry",
      interactionModel: "dom-events",
      flowModel: "paginated-pages"
    })
  })

  it("describes dom scroll chapters as browser-laid flow content", () => {
    expect(
      resolveRenderBackendCapabilities({
        backend: "dom",
        mode: "scroll"
      })
    ).toEqual({
      layoutAuthority: "browser-layout",
      geometrySource: "dom-geometry",
      interactionModel: "dom-events",
      flowModel: "dom-flow"
    })
  })
})
