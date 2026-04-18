import { describe, expect, it } from "vitest"
import { EpubReader } from "../src/runtime/reader"

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

describe("EpubReader preferences", () => {
  it("submits unified preferences and exposes resolved settings", async () => {
    const container = createContainer()
    const reader = new EpubReader({ container })

    const settings = await reader.submitPreferences({
      mode: "paginated",
      publisherStyles: "disabled",
      experimentalRtl: true,
      spreadMode: "always",
      theme: {
        background: "#182028",
        color: "#ecf4ff"
      },
      typography: {
        fontSize: 22,
        fontFamily: "Georgia, serif",
        letterSpacing: 0.5,
        wordSpacing: 3
      }
    })

    expect(reader.getPreferences()).toEqual({
      mode: "paginated",
      publisherStyles: "disabled",
      experimentalRtl: true,
      spreadMode: "always",
      theme: {
        background: "#182028",
        color: "#ecf4ff"
      },
      typography: {
        fontSize: 22,
        fontFamily: "Georgia, serif",
        letterSpacing: 0.5,
        wordSpacing: 3
      }
    })
    expect(settings).toEqual({
      mode: "paginated",
      publisherStyles: "disabled",
      experimentalRtl: true,
      spreadMode: "always",
      theme: {
        background: "#182028",
        color: "#ecf4ff"
      },
      typography: {
        fontSize: 22,
        lineHeight: 1.6,
        paragraphSpacing: 12,
        fontFamily: "Georgia, serif",
        letterSpacing: 0.5,
        wordSpacing: 3
      }
    })
    expect(reader.getSettings()).toEqual(settings)
    expect(reader.getTheme()).toEqual(settings.theme)
    expect(reader.getTypography()).toEqual(settings.typography)
    expect(container.style.fontSize).toBe("22px")
    expect(container.style.fontFamily).toBe("Georgia, serif")
    expect(container.style.letterSpacing).toBe("0.5px")
    expect(container.style.wordSpacing).toBe("3px")
    expect(container.style.getPropertyValue("--reader-bottom-padding")).toBe("24px")
  })

  it("restores serialized preferences and replaces previous explicit values", async () => {
    const container = createContainer()
    const reader = new EpubReader({ container })

    await reader.submitPreferences({
      mode: "paginated",
      publisherStyles: "disabled",
      experimentalRtl: true,
      spreadMode: "always",
      theme: {
        background: "#182028",
        color: "#ecf4ff"
      },
      typography: {
        fontSize: 21,
        lineHeight: 1.75,
        fontFamily: "Georgia, serif"
      }
    })
    const serialized = reader.serializePreferences()

    await reader.submitPreferences({
      mode: "scroll",
      publisherStyles: "enabled",
      experimentalRtl: false,
      spreadMode: "none",
      theme: {
        background: "#eef4ea",
        color: "#203126"
      },
      typography: {
        fontSize: 16,
        paragraphSpacing: 20,
        letterSpacing: 0.2
      }
    })
    const restored = await reader.restorePreferences(serialized)

    expect(reader.getPreferences()).toEqual({
      mode: "paginated",
      publisherStyles: "disabled",
      experimentalRtl: true,
      spreadMode: "always",
      theme: {
        background: "#182028",
        color: "#ecf4ff"
      },
      typography: {
        fontSize: 21,
        lineHeight: 1.75,
        fontFamily: "Georgia, serif"
      }
    })
    expect(restored).toEqual({
      mode: "paginated",
      publisherStyles: "disabled",
      experimentalRtl: true,
      spreadMode: "always",
      theme: {
        background: "#182028",
        color: "#ecf4ff"
      },
      typography: {
        fontSize: 21,
        lineHeight: 1.75,
        paragraphSpacing: 12,
        fontFamily: "Georgia, serif",
        letterSpacing: 0,
        wordSpacing: 0
      }
    })
  })
})
