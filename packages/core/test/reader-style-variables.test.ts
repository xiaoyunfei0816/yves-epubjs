import { describe, expect, it } from "vitest";
import { EpubReader } from "../src";

describe("EpubReader style variables", () => {
  it("applies shared reading style css variables to the container", async () => {
    const container = document.createElement("div");
    const reader = new EpubReader({
      container,
      theme: {
        background: "#182028",
        color: "#ecf4ff"
      },
      typography: {
        fontSize: 20,
        lineHeight: 1.7,
        paragraphSpacing: 14
      }
    });

    await reader.setTheme({
      background: "#182028",
      color: "#ecf4ff"
    });
    await reader.setTypography({
      fontSize: 20,
      lineHeight: 1.7,
      paragraphSpacing: 14
    });

    expect(container.style.getPropertyValue("--reader-side-padding")).toBe("8px");
    expect(container.style.getPropertyValue("--reader-bottom-padding")).toBe("24px");
    expect(container.style.getPropertyValue("--reader-link-color")).toBe("#1b4b72");
    expect(container.style.getPropertyValue("--reader-code-bg")).toBe("#0b1220");
    expect(container.style.getPropertyValue("--reader-inline-code-color")).toBe("#f8fafc");
  });
});
