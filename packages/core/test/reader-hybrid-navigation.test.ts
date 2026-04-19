import { describe, expect, it } from "vitest";
import type { Book, SectionDocument, TocItem } from "../src/model/types";
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
        <h1 id="intro">Simple</h1>
        <p>Plain reading flow.</p>
      </section>
    </body>
  </html>`;

const COMPLEX_CHAPTER = `<?xml version="1.0" encoding="utf-8"?>
  <html xmlns="http://www.w3.org/1999/xhtml">
    <head><title>Complex</title></head>
    <body>
      <section>
        <h1>Complex</h1>
        <p><a href="#details">Jump to details</a></p>
        <table>
          <tr><td>Fallback</td></tr>
        </table>
        <p id="details">Extra detail block.</p>
      </section>
    </body>
  </html>`;

const LONG_DOM_CHAPTER = `<?xml version="1.0" encoding="utf-8"?>
  <html xmlns="http://www.w3.org/1999/xhtml">
    <head><title>Long DOM</title></head>
    <body>
      <section>
        <h1>Long DOM</h1>
        <table>
          <tr><td>Force DOM backend</td></tr>
        </table>
        ${Array.from({ length: 18 }, (_, index) => `<p id="long-paragraph-${index + 1}">Paragraph ${index + 1} with enough text to keep the chapter flowing across multiple paginated viewport slices for regression coverage.</p>`).join("")}
      </section>
    </body>
  </html>`;

function createHybridReaderFixture(mode: "scroll" | "paginated" = "scroll"): {
  reader: EpubReader;
  container: HTMLDivElement;
  book: Book;
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

  const toc: TocItem[] = [
    {
      id: "toc-simple",
      label: "Simple",
      href: "OPS/simple.xhtml#intro",
      children: []
    },
    {
      id: "toc-complex",
      label: "Complex",
      href: "OPS/complex.xhtml#details",
      children: []
    }
  ];

  const book: Book = {
    metadata: { title: "Hybrid Navigation" },
    manifest: [],
    spine: [
      { idref: "item-1", href: simpleSection.href, linear: true },
      { idref: "item-2", href: complexSection.href, linear: true }
    ],
    toc,
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
    container,
    book
  };
}

function createLongDomReaderFixture(mode: "scroll" | "paginated" = "paginated"): {
  reader: EpubReader;
  container: HTMLDivElement;
  book: Book;
} {
  const container = document.createElement("div");
  container.style.padding = "20px 0 30px";
  Object.defineProperty(container, "clientWidth", {
    configurable: true,
    value: 320
  });
  Object.defineProperty(container, "clientHeight", {
    configurable: true,
    value: 480
  });
  document.body.appendChild(container);

  const longInput = createSharedChapterRenderInput({
    href: "OPS/long-dom.xhtml",
    content: LONG_DOM_CHAPTER
  });
  const longSection: SectionDocument = {
    ...toCanvasChapterRenderInput(longInput).section,
    id: "section-long-dom"
  };

  const book: Book = {
    metadata: { title: "Long DOM Pagination" },
    manifest: [],
    spine: [{ idref: "item-long-dom", href: longSection.href, linear: true }],
    toc: [],
    sections: [longSection]
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
  ).chapterRenderInputs = [longInput];

  return {
    reader,
    container,
    book
  };
}

describe("EpubReader hybrid navigation", () => {
  it("keeps toc navigation stable across canvas and dom chapters", async () => {
    const { reader, container } = createHybridReaderFixture();

    await reader.render();
    expect(reader.getRenderMetrics().backend).toBe("canvas");

    await reader.goToTocItem("toc-complex");
    expect(reader.getRenderMetrics().backend).toBe("dom");
    expect(reader.getCurrentLocation()?.spineIndex).toBe(1);
    expect(reader.getCurrentLocation()?.blockId).toBeTruthy();
    expect(container.dataset.renderMode).toBe("dom");

    await reader.goToTocItem("toc-simple");
    expect(reader.getRenderMetrics().backend).toBe("canvas");
    expect(reader.getCurrentLocation()?.spineIndex).toBe(0);
    expect(reader.getCurrentLocation()?.blockId).toBeTruthy();
    expect(container.dataset.renderMode).toBe("canvas");
  });

  it("uses rendered dom anchor targets for toc jumps before falling back to section progress", async () => {
    const originalOffsetTop = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetTop"
    );
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight"
    );
    const originalGetBoundingClientRect = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "getBoundingClientRect"
    );

    try {
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
            return 1400;
          }
          return originalOffsetHeight?.get?.call(this) ?? 0;
        }
      });
      Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
        configurable: true,
        value() {
          if (this === document.body.lastElementChild) {
            return {
              x: 0,
              y: 100,
              top: 100,
              left: 0,
              bottom: 580,
              right: 320,
              width: 320,
              height: 480,
              toJSON() {
                return this;
              }
            };
          }
          if (this.id === "details") {
            return {
              x: 0,
              y: 920 - currentScrollTop,
              top: 920 - currentScrollTop,
              left: 0,
              bottom: 948 - currentScrollTop,
              right: 320,
              width: 320,
              height: 28,
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

      const { reader, container } = createHybridReaderFixture();
      Object.defineProperty(container, "scrollTop", {
        configurable: true,
        get() {
          return currentScrollTop;
        },
        set(value: number) {
          currentScrollTop = value;
        }
      });

      await reader.render();
      await reader.goToTocItem("toc-complex");

      expect(reader.getRenderMetrics().backend).toBe("dom");
      expect(reader.getCurrentLocation()?.spineIndex).toBe(1);
      expect(reader.getCurrentLocation()?.blockId).toBeTruthy();
      expect(reader.getCurrentLocation()?.progressInSection ?? 0).toBeGreaterThan(0.5);
      expect(container.scrollTop).toBe(804);
    } finally {
      if (originalOffsetTop) {
        Object.defineProperty(HTMLElement.prototype, "offsetTop", originalOffsetTop);
      }
      if (originalOffsetHeight) {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
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

  it("maps locators and viewport points inside dom chapters without requiring canvas regions", async () => {
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

      Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get() {
          if (this.classList?.contains("epub-dom-section")) {
            return 1400;
          }
          return originalOffsetHeight?.get?.call(this) ?? 0;
        }
      });

      Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
        configurable: true,
        get() {
          if (this.classList?.contains("epub-dom-section")) {
            return 1400;
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
              y: 100,
              top: 100,
              left: 0,
              bottom: 580,
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
              y: 116,
              top: 116,
              left: 0,
              bottom: 516,
              right: 320,
              width: 320,
              height: 400,
              toJSON() {
                return this;
              }
            };
          }
          if (this.id === "details") {
            return {
              x: 12,
              y: 236,
              top: 236,
              left: 12,
              bottom: 264,
              right: 308,
              width: 296,
              height: 28,
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

      const { reader, container } = createHybridReaderFixture("paginated");
      currentContainer = container;

      await reader.render();
      expect(container.dataset.renderMode).toBe("canvas");

      await reader.goToTocItem("toc-complex");

      expect(reader.getRenderMetrics().backend).toBe("dom");
      const locator = reader.getCurrentLocation();
      expect(locator?.anchorId).toBe("details");

      const rects = reader.mapLocatorToViewport(locator!);
      expect(rects).toHaveLength(1);
      expect(rects[0]).toMatchObject({
        x: 12,
        y: 136,
        width: 296,
        height: 28
      });

      const mappedLocator = reader.mapViewportToLocator({
        x: 18,
        y: 142
      });
      expect(mappedLocator?.spineIndex).toBe(1);
      expect(mappedLocator?.anchorId).toBe("details");
      expect(mappedLocator?.blockId).toBeTruthy();
      expect(mappedLocator?.progressInSection ?? 0).toBeGreaterThan(0.08);
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

  it("keeps same-chapter anchor links inside dom chapters on the current section", async () => {
    const { reader, container } = createHybridReaderFixture();

    await reader.goToLocation({
      spineIndex: 1,
      progressInSection: 0
    });

    expect(reader.getRenderMetrics().backend).toBe("dom");
    const domLink = container.querySelector(".epub-dom-section a");
    expect(domLink).toBeTruthy();

    domLink?.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true
      })
    );
    await Promise.resolve();

    expect(reader.getRenderMetrics().backend).toBe("dom");
    expect(reader.getCurrentLocation()?.spineIndex).toBe(1);
    expect(reader.getCurrentLocation()?.blockId).toBeTruthy();
    expect(container.dataset.renderMode).toBe("dom");
  });

  it("maps dom anchored-fragment clicks onto the current locator contract", async () => {
    const originalGetBoundingClientRect = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "getBoundingClientRect"
    );
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight"
    );
    const originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight"
    );

    try {
      let currentContainer: HTMLElement | null = null;

      Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get() {
          if (this.classList?.contains("epub-dom-section")) {
            return 1400;
          }
          return originalOffsetHeight?.get?.call(this) ?? 0;
        }
      });

      Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
        configurable: true,
        get() {
          if (this.classList?.contains("epub-dom-section")) {
            return 1400;
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
              y: 100,
              top: 100,
              left: 0,
              bottom: 580,
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
              y: 116,
              top: 116,
              left: 0,
              bottom: 516,
              right: 320,
              width: 320,
              height: 400,
              toJSON() {
                return this;
              }
            };
          }
          if (this.id === "details") {
            return {
              x: 16,
              y: 236,
              top: 236,
              left: 16,
              bottom: 264,
              right: 304,
              width: 288,
              height: 28,
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

      const { reader, container } = createHybridReaderFixture("paginated");
      currentContainer = container;

      await reader.goToLocation({
        spineIndex: 1,
        progressInSection: 0
      });

      const details = container.querySelector("#details");
      expect(details).toBeTruthy();

      details?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: 180,
          clientY: 244
        })
      );

      expect(reader.getRenderMetrics().backend).toBe("dom");
      expect(reader.getCurrentLocation()?.spineIndex).toBe(1);
      expect(reader.getCurrentLocation()?.anchorId).toBe("details");
      expect(reader.getCurrentLocation()?.blockId).toBeTruthy();
      expect(reader.getCurrentLocation()?.progressInSection ?? 0).toBeGreaterThan(0.08);
    } finally {
      if (originalGetBoundingClientRect) {
        Object.defineProperty(
          HTMLElement.prototype,
          "getBoundingClientRect",
          originalGetBoundingClientRect
        );
      }
      if (originalOffsetHeight) {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
      }
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
      }
    }
  });

  it("positions paginated DOM pages with a translated viewport slice", async () => {
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight"
    );
    const originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight"
    );

    try {
      let currentScrollTop = 0;

      Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get() {
          if (
            this.classList?.contains("epub-dom-section") &&
            this.dataset?.sectionId === "section-long-dom"
          ) {
            return 1720;
          }
          return originalOffsetHeight?.get?.call(this) ?? 0;
        }
      });

      Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
        configurable: true,
        get() {
          if (
            this.classList?.contains("epub-dom-section") &&
            this.dataset?.sectionId === "section-long-dom"
          ) {
            return 1720;
          }
          return originalScrollHeight?.get?.call(this) ?? 0;
        }
      });

      const { reader, container } = createLongDomReaderFixture("paginated");
      Object.defineProperty(container, "scrollTop", {
        configurable: true,
        get() {
          return currentScrollTop;
        },
        set(value: number) {
          currentScrollTop = value;
        }
      });

      await reader.render();

      expect(reader.getRenderMetrics().backend).toBe("dom");
      expect(reader.getPaginationInfo().totalPages).toBe(4);

      await reader.goToPage(2);

      expect(reader.getPaginationInfo().currentPage).toBe(2);
      expect(container.scrollTop).toBe(0);
      expect(
        container.querySelector<HTMLElement>(".epub-dom-page-viewport")?.style.height
      ).toBe("430px");
      expect(
        container.querySelector<HTMLElement>(".epub-dom-section")?.style.transform
      ).toBe("translateY(-430px)");
    } finally {
      if (originalOffsetHeight) {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
      }
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
      }
    }
  });

  it("does not clamp the last paginated DOM slice back into repeated content", async () => {
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight"
    );
    const originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight"
    );

    try {
      let currentScrollTop = 0;

      Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get() {
          if (
            this.classList?.contains("epub-dom-section") &&
            this.dataset?.sectionId === "section-long-dom"
          ) {
            return 603;
          }
          return originalOffsetHeight?.get?.call(this) ?? 0;
        }
      });

      Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
        configurable: true,
        get() {
          if (
            this.classList?.contains("epub-dom-section") &&
            this.dataset?.sectionId === "section-long-dom"
          ) {
            return 603;
          }
          return originalScrollHeight?.get?.call(this) ?? 0;
        }
      });

      const { reader, container } = createLongDomReaderFixture("paginated");
      Object.defineProperty(container, "scrollTop", {
        configurable: true,
        get() {
          return currentScrollTop;
        },
        set(value: number) {
          currentScrollTop = value;
        }
      });

      await reader.render();

      expect(reader.getRenderMetrics().backend).toBe("dom");
      expect(reader.getPaginationInfo().totalPages).toBe(2);

      await reader.goToPage(2);

      expect(reader.getPaginationInfo().currentPage).toBe(2);
      expect(container.scrollTop).toBe(0);
      expect(
        container.querySelector<HTMLElement>(".epub-dom-section")?.style.transform
      ).toBe("translateY(-430px)");
    } finally {
      if (originalOffsetHeight) {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
      }
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
      }
    }
  });
});
