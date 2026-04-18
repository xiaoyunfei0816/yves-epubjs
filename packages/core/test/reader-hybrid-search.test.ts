import { describe, expect, it } from "vitest";
import type { Book, SectionDocument } from "../src/model/types";
import {
  EpubReader,
  createSharedChapterRenderInput,
  toCanvasChapterRenderInput
} from "../src";

const SIMPLE_CHAPTER = `<?xml version="1.0" encoding="utf-8"?>
  <html xmlns="http://www.w3.org/1999/xhtml">
    <head><title>Simple</title></head>
    <body>
      <section>
        <h1>Simple chapter</h1>
        <p>Canvas search target.</p>
      </section>
    </body>
  </html>`;

const COMPLEX_CHAPTER = `<?xml version="1.0" encoding="utf-8"?>
  <html xmlns="http://www.w3.org/1999/xhtml">
    <head><title>Complex</title></head>
    <body>
      <section>
        <h1>Complex chapter</h1>
        <p>${"Opening context. ".repeat(80)}</p>
        <table>
          <tr><td>DOM search target.</td></tr>
        </table>
        <p>${"Closing context. ".repeat(80)}</p>
      </section>
    </body>
  </html>`;

function createHybridSearchFixture(mode: "scroll" | "paginated" = "scroll"): {
  reader: EpubReader;
  container: HTMLDivElement;
} {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", {
    configurable: true,
    value: 320
  });
  Object.defineProperty(container, "clientHeight", {
    configurable: true,
    value: 480
  });
  document.body.appendChild(container);

  const simpleInput = createSharedChapterRenderInput({
    href: "OPS/simple.xhtml",
    content: SIMPLE_CHAPTER
  });
  const complexInput = createSharedChapterRenderInput({
    href: "OPS/complex.xhtml",
    content: COMPLEX_CHAPTER
  });
  const simpleSection: SectionDocument = {
    ...toCanvasChapterRenderInput(simpleInput).section,
    id: "section-1"
  };
  const complexSection: SectionDocument = {
    ...toCanvasChapterRenderInput(complexInput).section,
    id: "section-2"
  };

  const book: Book = {
    metadata: { title: "Hybrid Search" },
    manifest: [],
    spine: [
      { idref: "item-1", href: simpleSection.href, linear: true },
      { idref: "item-2", href: complexSection.href, linear: true }
    ],
    toc: [],
    sections: [simpleSection, complexSection]
  };

  const reader = new EpubReader({ container, mode });
  (
    reader as unknown as {
      book: Book;
      chapterRenderInputs: ReturnType<typeof createSharedChapterRenderInput>[];
    }
  ).book = book;
  (
    reader as unknown as {
      book: Book;
      chapterRenderInputs: ReturnType<typeof createSharedChapterRenderInput>[];
    }
  ).chapterRenderInputs = [simpleInput, complexInput];

  return {
    reader,
    container
  };
}

describe("EpubReader hybrid search", () => {
  it("navigates search results into canvas and dom chapters through a unified adapter", async () => {
    const { reader, container } = createHybridSearchFixture();

    const canvasResults = await reader.search("Canvas search target");
    const domResults = await reader.search("DOM search target");

    expect(canvasResults).toHaveLength(1);
    expect(domResults).toHaveLength(1);

    await reader.goToSearchResult(domResults[0]!);
    expect(reader.getRenderMetrics().backend).toBe("dom");
    expect(reader.getCurrentLocation()?.spineIndex).toBe(1);
    expect(container.dataset.renderMode).toBe("dom");

    await reader.goToSearchResult(canvasResults[0]!);
    expect(reader.getRenderMetrics().backend).toBe("canvas");
    expect(reader.getCurrentLocation()?.spineIndex).toBe(0);
    expect(container.dataset.renderMode).toBe("canvas");
  });

  it("preserves block progress for dom search results so long chapters do not jump back to the top", async () => {
    const originalOffsetTop = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetTop"
    );
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight"
    );

    try {
      Object.defineProperty(HTMLElement.prototype, "offsetTop", {
        configurable: true,
        get() {
          const sectionId = this.dataset?.sectionId;
          if (sectionId === "section-1") {
            return 0;
          }
          if (sectionId === "section-2") {
            return 520;
          }
          return originalOffsetTop?.get?.call(this) ?? 0;
        }
      });

      Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get() {
          const sectionId = this.dataset?.sectionId;
          if (sectionId === "section-1") {
            return 520;
          }
          if (sectionId === "section-2") {
            return 2800;
          }
          return originalOffsetHeight?.get?.call(this) ?? 0;
        }
      });

      const { reader, container } = createHybridSearchFixture();
      Object.defineProperty(container, "scrollTop", {
        configurable: true,
        writable: true,
        value: 0
      });

      const results = await reader.search("DOM search target");
      expect(results).toHaveLength(1);
      expect(results[0]?.locator.progressInSection ?? 0).toBeGreaterThan(0.25);

      await reader.goToSearchResult(results[0]!);

      expect(reader.getRenderMetrics().backend).toBe("dom");
      expect(reader.getCurrentLocation()?.spineIndex).toBe(1);
      expect(container.scrollTop).toBeGreaterThan(900);
    } finally {
      if (originalOffsetTop) {
        Object.defineProperty(HTMLElement.prototype, "offsetTop", originalOffsetTop);
      }
      if (originalOffsetHeight) {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
      }
    }
  });

  it("keeps dom locator mapping available after navigating to a search result", async () => {
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight"
    );
    const originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight"
    );
    const originalGetBoundingClientRect = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "getBoundingClientRect"
    );

    try {
      let currentContainer: HTMLElement | null = null;
      let targetBlockId = "table-1";

      Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get() {
          if (this.classList?.contains("epub-dom-section")) {
            return 1800;
          }
          return originalOffsetHeight?.get?.call(this) ?? 0;
        }
      });

      Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
        configurable: true,
        get() {
          if (this.classList?.contains("epub-dom-section")) {
            return 1800;
          }
          return originalScrollHeight?.get?.call(this) ?? 0;
        }
      });

      Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
        configurable: true,
        value() {
          if (this === currentContainer) {
            return {
              x: 0,
              y: 80,
              top: 80,
              left: 0,
              bottom: 560,
              right: 320,
              width: 320,
              height: 480,
              toJSON() {
                return this;
              }
            };
          }
          if (this.classList?.contains("epub-dom-section")) {
            return {
              x: 0,
              y: 96,
              top: 96,
              left: 0,
              bottom: 516,
              right: 320,
              width: 320,
              height: 420,
              toJSON() {
                return this;
              }
            };
          }
          if (this.id === targetBlockId) {
            return {
              x: 20,
              y: 300,
              top: 300,
              left: 20,
              bottom: 348,
              right: 300,
              width: 280,
              height: 48,
              toJSON() {
                return this;
              }
            };
          }
          return originalGetBoundingClientRect?.value?.call(this) ?? {
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            bottom: 0,
            right: 0,
            width: 0,
            height: 0,
            toJSON() {
              return this;
            }
          };
        }
      });

      const { reader, container } = createHybridSearchFixture("paginated");
      currentContainer = container;
      const results = await reader.search("DOM search target");
      expect(results).toHaveLength(1);
      targetBlockId = results[0]?.locator.blockId ?? targetBlockId;
      expect(targetBlockId).toBeTruthy();

      await reader.goToSearchResult(results[0]!);

      const rects = reader.mapLocatorToViewport(results[0]!.locator);
      expect(rects).toHaveLength(1);
      expect(rects[0]?.height).toBeGreaterThan(0);
      expect(rects[0]?.y).toBeGreaterThan(0);

      const locator = reader.mapViewportToLocator({
        x: 28,
        y: 228
      });
      expect(locator?.spineIndex).toBe(1);
      expect(locator?.progressInSection ?? 0).toBeGreaterThan(0.1);
    } finally {
      if (originalOffsetHeight) {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
      }
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
      }
      if (originalGetBoundingClientRect) {
        Object.defineProperty(
          HTMLElement.prototype,
          "getBoundingClientRect",
          originalGetBoundingClientRect
        );
      }
    }
  });

  it("realigns dom search results to the rendered match element after initial location restore", async () => {
    const originalOffsetTop = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetTop"
    );
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight"
    );
    const originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight"
    );
    const originalGetBoundingClientRect = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "getBoundingClientRect"
    );

    try {
      let currentContainer: HTMLElement | null = null;
      let currentScrollTop = 0;

      Object.defineProperty(HTMLElement.prototype, "offsetTop", {
        configurable: true,
        get() {
          const sectionId = this.dataset?.sectionId;
          if (sectionId === "section-1") {
            return 0;
          }
          if (sectionId === "section-2") {
            return 520;
          }
          return originalOffsetTop?.get?.call(this) ?? 0;
        }
      });

      Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get() {
          const sectionId = this.dataset?.sectionId;
          if (sectionId === "section-1") {
            return 520;
          }
          if (sectionId === "section-2") {
            return 2200;
          }
          if (this.classList?.contains("epub-dom-section")) {
            return 1800;
          }
          return originalOffsetHeight?.get?.call(this) ?? 0;
        }
      });

      Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
        configurable: true,
        get() {
          if (this.classList?.contains("epub-dom-section")) {
            return 1800;
          }
          return originalScrollHeight?.get?.call(this) ?? 0;
        }
      });

      Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
        configurable: true,
        value() {
          if (this === currentContainer) {
            return {
              x: 0,
              y: 80,
              top: 80,
              left: 0,
              bottom: 560,
              right: 320,
              width: 320,
              height: 480,
              toJSON() {
                return this;
              }
            };
          }
          if (this.classList?.contains("epub-dom-section")) {
            return {
              x: 0,
              y: 80 + 520 - currentScrollTop,
              top: 80 + 520 - currentScrollTop,
              left: 0,
              bottom: 80 + 520 - currentScrollTop + 420,
              right: 320,
              width: 320,
              height: 420,
              toJSON() {
                return this;
              }
            };
          }
          if (
            this !== currentContainer &&
            this.textContent?.includes("DOM search target")
          ) {
            return {
              x: 20,
              y: 80 + 1400 - currentScrollTop,
              top: 80 + 1400 - currentScrollTop,
              left: 20,
              bottom: 80 + 1400 - currentScrollTop + 48,
              right: 300,
              width: 280,
              height: 48,
              toJSON() {
                return this;
              }
            };
          }
          return originalGetBoundingClientRect?.value?.call(this) ?? {
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            bottom: 0,
            right: 0,
            width: 0,
            height: 0,
            toJSON() {
              return this;
            }
          };
        }
      });

      const { reader, container } = createHybridSearchFixture("scroll");
      currentContainer = container;
      Object.defineProperty(container, "scrollTop", {
        configurable: true,
        get() {
          return currentScrollTop;
        },
        set(value: number) {
          currentScrollTop = value;
        }
      });

      const results = await reader.search("DOM search target");
      expect(results).toHaveLength(1);
      expect(results[0]?.matchText).toBe("DOM search target");

      await reader.goToSearchResult(results[0]!);

      expect(reader.getRenderMetrics().backend).toBe("dom");
      expect(container.scrollTop).toBe(1384);
      expect(reader.getCurrentLocation()?.spineIndex).toBe(1);
      expect(reader.getCurrentLocation()?.progressInSection ?? 0).toBeGreaterThan(0.38);
      expect(reader.getCurrentLocation()?.progressInSection ?? 0).toBeLessThan(0.41);
    } finally {
      if (originalOffsetTop) {
        Object.defineProperty(HTMLElement.prototype, "offsetTop", originalOffsetTop);
      }
      if (originalOffsetHeight) {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
      }
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
      }
      if (originalGetBoundingClientRect) {
        Object.defineProperty(
          HTMLElement.prototype,
          "getBoundingClientRect",
          originalGetBoundingClientRect
        );
      }
    }
  });

  it("navigates canvas search results for nested list blocks to the exact page instead of falling back to coarse progress", async () => {
    const container = document.createElement("div")
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 320
    })
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 220
    })
    document.body.appendChild(container)

    const nestedListItems = Array.from({ length: 48 }, (_, index) =>
      index === 0
        ? "<li><p>Canvas nested search target.</p></li>"
        : `<li><p>Supplement ${index + 1}</p></li>`
    ).join("")
    const canvasInput = createSharedChapterRenderInput({
      href: "OPS/nested-list.xhtml",
      content: `<?xml version="1.0" encoding="utf-8"?>
        <html xmlns="http://www.w3.org/1999/xhtml">
          <head><title>Nested Canvas Search</title></head>
          <body>
            <section>
              <p>${"Opening context. ".repeat(260)}</p>
              <ol>
                ${nestedListItems}
              </ol>
            </section>
          </body>
        </html>`
    })
    const canvasSection: SectionDocument = {
      ...toCanvasChapterRenderInput(canvasInput).section,
      id: "section-1"
    }
    const book: Book = {
      metadata: { title: "Canvas Nested Search" },
      manifest: [],
      spine: [{ idref: "item-1", href: canvasSection.href, linear: true }],
      toc: [],
      sections: [canvasSection]
    }

    const reader = new EpubReader({ container, mode: "paginated" })
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
    ).chapterRenderInputs = [canvasInput]

    await reader.render()

    const results = await reader.search("Canvas nested search target")
    expect(results).toHaveLength(1)

    await reader.goToSearchResult(results[0]!)

    expect(reader.getRenderMetrics().backend).toBe("canvas")
    expect(reader.getPaginationInfo().currentPage).toBeGreaterThan(1)
    expect(reader.getCurrentLocation()?.blockId).toBe(results[0]?.locator.blockId)
    expect(reader.mapLocatorToViewport(results[0]!.locator).length).toBeGreaterThan(0)
  })
});
