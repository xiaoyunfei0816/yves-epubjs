import { describe, expect, it } from "vitest";
import { LayoutEngine } from "../src/layout/layout-engine";
import type { Book, SectionDocument } from "../src/model/types";
import { parseXhtmlDocument } from "../src/parser/xhtml-parser";
import { EpubReader } from "../src/runtime/reader";

const typography = {
  fontSize: 18,
  lineHeight: 1.6,
  paragraphSpacing: 12
} as const;

function createSection(): SectionDocument {
  return {
    id: "section-1",
    href: "OPS/chapter-1.xhtml",
    title: "Chapter 1",
    blocks: [
      {
        id: "heading-1",
        kind: "heading",
        level: 1,
        inlines: [{ kind: "text", text: "A Long Heading That Wraps" }]
      },
      {
        id: "text-1",
        kind: "text",
        inlines: [
          { kind: "text", text: "This paragraph is rendered through pretext. " },
          { kind: "strong", children: [{ kind: "text", text: "Bold text" }] },
          { kind: "text", text: " and " },
          {
            kind: "link",
            href: "#target",
            children: [{ kind: "text", text: "linked text" }]
          },
          { kind: "text", text: " should all participate in line layout." }
        ]
      }
    ],
    anchors: {}
  };
}

describe("pretext layout integration", () => {
  it("lays out text-like blocks with pretext line data", () => {
    const engine = new LayoutEngine();
    const section = createSection();

    const layout = engine.layout(
      {
        section,
        spineIndex: 0,
        viewportWidth: 220,
        viewportHeight: 600,
        typography,
        fontFamily: "serif"
      },
      "scroll"
    );

    expect(layout.blocks[0]?.type).toBe("pretext");
    expect(layout.blocks[1]?.type).toBe("pretext");
    expect(layout.blocks[1]?.type === "pretext" && layout.blocks[1].lines.length).toBeGreaterThan(1);
    expect(layout.locatorMap.get("text-1")).toEqual({
      spineIndex: 0,
      blockId: "text-1",
      progressInSection: 0
    });
  });

  it("renders pretext-driven content with the canvas backend by default", async () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 280
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 640
    });
    document.body.appendChild(container);

    const reader = new EpubReader({ container });
    const section = createSection();
    const book: Book = {
      metadata: {
        title: "Demo"
      },
      manifest: [],
      spine: [
        {
          idref: "item-1",
          href: section.href,
          linear: true
        }
      ],
      toc: [],
      sections: [section]
    };

    const state = reader as unknown as {
      book: Book;
    };
    state.book = book;

    await reader.render();

    expect(container.querySelector("canvas.epub-canvas-section")).toBeTruthy();
    expect(reader.getRenderMetrics().backend).toBe("canvas");
    expect(reader.getVisibleDrawBounds().length).toBeGreaterThan(1);
  });

  it("renders paginated content to canvas", async () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 280
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 320
    });
    document.body.appendChild(container);

    const reader = new EpubReader({
      container,
      mode: "paginated"
    });
    const section = createSection();
    const book: Book = {
      metadata: {
        title: "Canvas Demo"
      },
      manifest: [],
      spine: [
        {
          idref: "item-1",
          href: section.href,
          linear: true
        }
      ],
      toc: [],
      sections: [section]
    };

    (reader as unknown as { book: Book }).book = book;
    await reader.render();

    expect(container.querySelector("canvas.epub-canvas-paginated")).toBeTruthy();
    expect(reader.getRenderMetrics().backend).toBe("canvas");
    expect(reader.getVisibleDrawBounds().length).toBeGreaterThan(0);
  });

  it("supports image hit testing in canvas mode", async () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 320
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 320
    });
    document.body.appendChild(container);

    const reader = new EpubReader({
      container,
      mode: "paginated"
    });

    const section: SectionDocument = {
      id: "section-image",
      href: "OPS/image.xhtml",
      title: "Images",
      anchors: {},
      blocks: [
        {
          id: "image-1",
          kind: "image",
          src: "OPS/cover.jpg",
          alt: "Cover",
          width: 320,
          height: 240
        }
      ]
    };

    const book: Book = {
      metadata: { title: "Images" },
      manifest: [],
      spine: [
        {
          idref: "item-1",
          href: section.href,
          linear: true
        }
      ],
      toc: [],
      sections: [section]
    };

    (reader as unknown as { book: Book }).book = book;
    await reader.render();

    const hit = reader.hitTest({
      x: 40,
      y: 90
    });

    expect(hit?.kind).toBe("image");
    expect(hit?.blockId).toBe("image-1");
  });

  it("tracks highlighted draw ops after a canvas search", async () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 280
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 320
    });
    document.body.appendChild(container);

    const reader = new EpubReader({
      container,
      mode: "paginated"
    });
    const section = createSection();
    const book: Book = {
      metadata: { title: "Search Demo" },
      manifest: [],
      spine: [
        {
          idref: "item-1",
          href: section.href,
          linear: true
        }
      ],
      toc: [],
      sections: [section]
    };

    (reader as unknown as { book: Book }).book = book;
    await reader.render();
    const results = await reader.search("linked text");

    expect(results).toHaveLength(1);
    expect(reader.getRenderMetrics().highlightedDrawOpCount).toBeGreaterThan(0);
  });

  it("maps locator to viewport in canvas mode", async () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 280
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 320
    });
    document.body.appendChild(container);

    const reader = new EpubReader({
      container,
      mode: "paginated"
    });
    const section = createSection();
    const book: Book = {
      metadata: { title: "Map Demo" },
      manifest: [],
      spine: [
        {
          idref: "item-1",
          href: section.href,
          linear: true
        }
      ],
      toc: [],
      sections: [section]
    };

    (reader as unknown as { book: Book }).book = book;
    await reader.render();

    const rects = reader.mapLocatorToViewport({
      spineIndex: 0,
      blockId: "text-1",
      progressInSection: 0
    });

    expect(rects.length).toBeGreaterThan(0);
    expect(rects[0]?.height).toBeGreaterThan(0);
  });

  it("maps viewport points back to locators in canvas mode", async () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 280
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 320
    });
    document.body.appendChild(container);

    const reader = new EpubReader({
      container,
      mode: "paginated"
    });
    const section = createSection();
    const book: Book = {
      metadata: { title: "Map Back Demo" },
      manifest: [],
      spine: [
        {
          idref: "item-1",
          href: section.href,
          linear: true
        }
      ],
      toc: [],
      sections: [section]
    };

    (reader as unknown as { book: Book }).book = book;
    await reader.render();

    const rects = reader.mapLocatorToViewport({
      spineIndex: 0,
      blockId: "text-1",
      progressInSection: 0
    });
    const target = rects[0];
    expect(target).toBeTruthy();

    const locator = reader.mapViewportToLocator({
      x: (target?.x ?? 0) + 6,
      y: (target?.y ?? 0) + 6
    });

    expect(locator?.spineIndex).toBe(0);
    expect(locator?.blockId).toBe("text-1");
  });

  it("supports paginated navigation and page lookup", async () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 260
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 180
    });
    document.body.appendChild(container);

    const reader = new EpubReader({
      container,
      mode: "paginated"
    });

    const repeatedText = Array.from({ length: 28 }, () => ({
      kind: "text" as const,
      text: "This is a long paragraph designed to spill across multiple pages. "
    }));
    const section: SectionDocument = {
      ...createSection(),
      blocks: [
        {
          id: "text-1",
          kind: "text",
          inlines: repeatedText
        }
      ]
    };

    const book: Book = {
      metadata: {
        title: "Paged Demo"
      },
      manifest: [],
      spine: [
        {
          idref: "item-1",
          href: section.href,
          linear: true
        }
      ],
      toc: [],
      sections: [section]
    };

    const state = reader as unknown as {
      book: Book;
    };
    state.book = book;

    await reader.render();

    const firstPage = reader.getPaginationInfo();
    expect(firstPage.totalPages).toBeGreaterThan(1);
    expect(firstPage.currentPage).toBe(1);

    await reader.goToPage(firstPage.totalPages);
    expect(reader.getPaginationInfo().currentPage).toBe(firstPage.totalPages);

    await reader.prev();
    expect(reader.getPaginationInfo().currentPage).toBe(firstPage.totalPages - 1);
  });

  it("keeps pagination global across sections and resolves paginated locations correctly", async () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 260
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 180
    });
    document.body.appendChild(container);

    const reader = new EpubReader({
      container,
      mode: "paginated"
    });

    const repeatedText = Array.from({ length: 24 }, () => ({
      kind: "text" as const,
      text: "This is a long paragraph designed to spill across multiple pages. "
    }));
    const firstSection: SectionDocument = {
      ...createSection(),
      id: "section-1",
      href: "OPS/chapter-1.xhtml",
      title: "Chapter 1",
      blocks: [
        {
          id: "text-1",
          kind: "text",
          inlines: repeatedText
        }
      ]
    };
    const secondSection: SectionDocument = {
      ...createSection(),
      id: "section-2",
      href: "OPS/chapter-2.xhtml",
      title: "Chapter 2",
      blocks: [
        {
          id: "text-2",
          kind: "text",
          inlines: repeatedText
        }
      ]
    };

    const book: Book = {
      metadata: {
        title: "Paged Demo"
      },
      manifest: [],
      spine: [
        {
          idref: "item-1",
          href: firstSection.href,
          linear: true
        },
        {
          idref: "item-2",
          href: secondSection.href,
          linear: true
        }
      ],
      toc: [],
      sections: [firstSection, secondSection]
    };

    const state = reader as unknown as {
      book: Book;
    };
    state.book = book;

    await reader.render();

    const pagination = reader.getPaginationInfo();
    expect(pagination.totalPages).toBeGreaterThan(2);

    await reader.goToPage(pagination.totalPages);

    expect(reader.getPaginationInfo().currentPage).toBe(pagination.totalPages);
    expect(reader.getCurrentLocation()?.spineIndex).toBe(1);
    expect(
      container.querySelector('canvas.epub-canvas-paginated[data-section-id="section-2"]')
    ).toBeTruthy();

    await reader.goToLocation({
      spineIndex: 1,
      progressInSection: 1
    });

    expect(reader.getPaginationInfo().currentPage).toBe(pagination.totalPages);
    expect(
      container.querySelector('canvas.epub-canvas-paginated[data-section-id="section-2"]')
    ).toBeTruthy();
  });

  it("keeps total pages stable when navigating between sections", async () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 260
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 420
    });
    document.body.appendChild(container);

    const reader = new EpubReader({
      container,
      mode: "scroll"
    });

    const repeatedText = Array.from({ length: 24 }, () => ({
      kind: "text" as const,
      text: "This is a long paragraph designed to spill across multiple pages. "
    }));
    const firstSection: SectionDocument = {
      ...createSection(),
      id: "section-1",
      href: "OPS/chapter-1.xhtml",
      title: "Chapter 1",
      blocks: [
        {
          id: "text-1",
          kind: "text",
          inlines: repeatedText
        }
      ]
    };
    const secondSection: SectionDocument = {
      ...createSection(),
      id: "section-2",
      href: "OPS/chapter-2.xhtml",
      title: "Chapter 2",
      blocks: [
        {
          id: "text-2",
          kind: "text",
          inlines: repeatedText
        }
      ]
    };

    const book: Book = {
      metadata: {
        title: "Paged Demo"
      },
      manifest: [],
      spine: [
        {
          idref: "item-1",
          href: firstSection.href,
          linear: true
        },
        {
          idref: "item-2",
          href: secondSection.href,
          linear: true
        }
      ],
      toc: [],
      sections: [firstSection, secondSection]
    };

    const state = reader as unknown as {
      book: Book;
    };
    state.book = book;

    await reader.render();
    const firstTotal = reader.getPaginationInfo().totalPages;

    await reader.goToLocation({
      spineIndex: 1,
      progressInSection: 0
    });
    const secondTotal = reader.getPaginationInfo().totalPages;

    await reader.goToLocation({
      spineIndex: 0,
      progressInSection: 0
    });
    const thirdTotal = reader.getPaginationInfo().totalPages;

    expect(secondTotal).toBe(firstTotal);
    expect(thirdTotal).toBe(firstTotal);
  });

  it("navigates toc items with fragment hrefs to the matching section", async () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 260
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 420
    });
    document.body.appendChild(container);

    const reader = new EpubReader({
      container,
      mode: "scroll"
    });

    const firstSection: SectionDocument = {
      ...createSection(),
      id: "section-1",
      href: "OPS/chapter-1.xhtml",
      title: "Chapter 1",
      anchors: {
        intro: "text-1"
      }
    };
    const secondSection: SectionDocument = {
      ...createSection(),
      id: "section-2",
      href: "OPS/chapter-2.xhtml",
      title: "Chapter 2"
    };

    const book: Book = {
      metadata: {
        title: "Paged Demo"
      },
      manifest: [],
      spine: [
        {
          idref: "item-1",
          href: firstSection.href,
          linear: true
        },
        {
          idref: "item-2",
          href: secondSection.href,
          linear: true
        }
      ],
      toc: [
        {
          id: "toc-1",
          label: "Intro",
          href: "OPS/chapter-1.xhtml#intro",
          children: []
        },
        {
          id: "toc-2",
          label: "Chapter 2",
          href: "OPS/chapter-2.xhtml",
          children: []
        }
      ],
      sections: [firstSection, secondSection]
    };

    const state = reader as unknown as {
      book: Book;
    };
    state.book = book;

    await reader.render();
    await reader.goToTocItem("toc-2");
    expect(reader.getCurrentLocation()?.spineIndex).toBe(1);

    await reader.goToTocItem("toc-1");
    expect(reader.getCurrentLocation()?.spineIndex).toBe(0);
  });

  it("uses toc fragment anchors to update the current page within the same section", async () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 260
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 180
    });
    document.body.appendChild(container);

    const reader = new EpubReader({
      container,
      mode: "scroll"
    });

    const repeatedText = Array.from({ length: 24 }, () => ({
      kind: "text" as const,
      text: "This is a long paragraph designed to spill across multiple pages. "
    }));
    const section: SectionDocument = {
      ...createSection(),
      id: "section-1",
      href: "OPS/chapter-1.xhtml",
      title: "Chapter 1",
      blocks: [
        {
          id: "text-1",
          kind: "text",
          inlines: repeatedText
        },
        {
          id: "text-2",
          kind: "text",
          inlines: repeatedText
        }
      ],
      anchors: {
        later: "text-2"
      }
    };

    const book: Book = {
      metadata: {
        title: "Paged Demo"
      },
      manifest: [],
      spine: [
        {
          idref: "item-1",
          href: section.href,
          linear: true
        }
      ],
      toc: [
        {
          id: "toc-later",
          label: "Later",
          href: "OPS/chapter-1.xhtml#later",
          children: []
        }
      ],
      sections: [section]
    };

    const state = reader as unknown as {
      book: Book;
    };
    state.book = book;

    await reader.render();
    expect(reader.getPaginationInfo().currentPage).toBe(1);

    await reader.goToTocItem("toc-later");
    expect(reader.getCurrentLocation()?.blockId).toBe("text-2");
    expect(reader.getPaginationInfo().currentPage).toBeGreaterThan(1);
  });

  it("resolves toc fragment anchors declared on structural containers", async () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 260
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 180
    });
    document.body.appendChild(container);

    const reader = new EpubReader({
      container,
      mode: "scroll"
    });

    const sectionDocument = parseXhtmlDocument(
      `<?xml version="1.0"?>
      <html>
        <head><title>Chapter 1</title></head>
        <body>
          <div id="intro">
            <h1>Intro</h1>
          </div>
          <p>${"Intro paragraph ".repeat(24)}</p>
          <section id="later">
            <h2>Later</h2>
            <p>${"Later paragraph ".repeat(40)}</p>
          </section>
        </body>
      </html>`,
      "OPS/chapter-1.xhtml"
    );
    const section: SectionDocument = {
      ...sectionDocument,
      id: "section-1"
    };

    const book: Book = {
      metadata: {
        title: "Container Anchor Demo"
      },
      manifest: [],
      spine: [
        {
          idref: "item-1",
          href: section.href,
          linear: true
        }
      ],
      toc: [
        {
          id: "toc-later",
          label: "Later",
          href: "OPS/chapter-1.xhtml#later",
          children: []
        }
      ],
      sections: [section]
    };

    const state = reader as unknown as {
      book: Book;
    };
    state.book = book;

    await reader.render();
    await reader.goToTocItem("toc-later");

    expect(reader.getCurrentLocation()?.blockId).toBe(section.anchors.later);
    expect(reader.getCurrentLocation()?.spineIndex).toBe(0);
  });

  it("resolves toc fragment anchors declared as standalone markers inside the same section", async () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 260
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 180
    });
    document.body.appendChild(container);

    const reader = new EpubReader({
      container,
      mode: "scroll"
    });

    const sectionDocument = parseXhtmlDocument(
      `<?xml version="1.0"?>
      <html>
        <head><title>Combined Chapters</title></head>
        <body>
          <a id="chapter-1"></a>
          <h1>Chapter 1</h1>
          <p>${"Chapter one paragraph ".repeat(24)}</p>
          <a id="chapter-4"></a>
          <a name="chapter-4-name"></a>
          <h1>Chapter 4</h1>
          <p>${"Chapter four paragraph ".repeat(40)}</p>
        </body>
      </html>`,
      "OPS/text00011.html"
    );
    const section: SectionDocument = {
      ...sectionDocument,
      id: "section-1"
    };

    const book: Book = {
      metadata: {
        title: "Combined Chapter Demo"
      },
      manifest: [],
      spine: [
        {
          idref: "item-1",
          href: section.href,
          linear: true
        }
      ],
      toc: [
        {
          id: "toc-chapter-4",
          label: "Chapter 4",
          href: "OPS/text00011.html#chapter-4",
          children: []
        }
      ],
      sections: [section]
    };

    (reader as unknown as { book: Book }).book = book;

    await reader.render();
    await reader.goToTocItem("toc-chapter-4");

    expect(reader.getCurrentLocation()?.blockId).toBe(section.anchors["chapter-4"]);
    expect(reader.getCurrentLocation()?.blockId).toBe(section.anchors["chapter-4-name"]);
  });

  it("keeps canvas scroll toc jumps aligned with the real section offsets", async () => {
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
          if (sectionId === "section-3") {
            return 1040;
          }
          return originalOffsetTop?.get?.call(this) ?? 0;
        }
      });

      Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get() {
          const sectionId = this.dataset?.sectionId;
          if (sectionId === "section-1" || sectionId === "section-2") {
            return 520;
          }
          if (sectionId === "section-3") {
            return 560;
          }
          return originalOffsetHeight?.get?.call(this) ?? 0;
        }
      });

      const container = document.createElement("div");
      Object.defineProperty(container, "clientWidth", {
        configurable: true,
        value: 260
      });
      Object.defineProperty(container, "clientHeight", {
        configurable: true,
        value: 180
      });
      Object.defineProperty(container, "scrollTop", {
        configurable: true,
        writable: true,
        value: 0
      });
      document.body.appendChild(container);

      const reader = new EpubReader({
        container,
        mode: "scroll"
      });

      const repeatedText = Array.from({ length: 20 }, () => ({
        kind: "text" as const,
        text: "This is a long paragraph designed to spill across multiple pages. "
      }));
      const firstSection: SectionDocument = {
        ...createSection(),
        id: "section-1",
        href: "OPS/chapter-1.xhtml",
        title: "Chapter 1",
        blocks: [
          {
            id: "text-1a",
            kind: "text",
            inlines: repeatedText
          }
        ]
      };
      const secondSection: SectionDocument = {
        ...createSection(),
        id: "section-2",
        href: "OPS/chapter-2.xhtml",
        title: "Chapter 2",
        blocks: [
          {
            id: "text-2a",
            kind: "text",
            inlines: repeatedText
          }
        ]
      };
      const thirdSection: SectionDocument = {
        ...createSection(),
        id: "section-3",
        href: "OPS/chapter-3.xhtml",
        title: "Chapter 3",
        blocks: [
          {
            id: "text-3a",
            kind: "text",
            inlines: repeatedText
          },
          {
            id: "text-3b",
            kind: "text",
            inlines: repeatedText
          }
        ],
        anchors: {
          later: "text-3b"
        }
      };

      const book: Book = {
        metadata: {
          title: "Canvas TOC Demo"
        },
        manifest: [],
        spine: [
          { idref: "item-1", href: firstSection.href, linear: true },
          { idref: "item-2", href: secondSection.href, linear: true },
          { idref: "item-3", href: thirdSection.href, linear: true }
        ],
        toc: [
          {
            id: "toc-later",
            label: "Later",
            href: "OPS/chapter-3.xhtml#later",
            children: []
          }
        ],
        sections: [firstSection, secondSection, thirdSection]
      };

      (reader as unknown as { book: Book }).book = book;
      await reader.render();
      await reader.goToTocItem("toc-later");

      expect(reader.getCurrentLocation()?.spineIndex).toBe(2);
      expect(reader.getCurrentLocation()?.blockId).toBe("text-3b");
      expect(container.scrollTop).toBeGreaterThan(900);
    } finally {
      if (originalOffsetTop) {
        Object.defineProperty(HTMLElement.prototype, "offsetTop", originalOffsetTop);
      }
      if (originalOffsetHeight) {
        Object.defineProperty(
          HTMLElement.prototype,
          "offsetHeight",
          originalOffsetHeight
        );
      }
    }
  });

  it("uses global page numbers for page jumps in scroll mode", async () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 260
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 180
    });
    document.body.appendChild(container);

    const reader = new EpubReader({
      container,
      mode: "scroll"
    });

    const repeatedText = Array.from({ length: 24 }, () => ({
      kind: "text" as const,
      text: "This is a long paragraph designed to spill across multiple pages. "
    }));
    const firstSection: SectionDocument = {
      ...createSection(),
      id: "section-1",
      href: "OPS/chapter-1.xhtml",
      title: "Chapter 1",
      blocks: [
        {
          id: "text-1",
          kind: "text",
          inlines: repeatedText
        }
      ]
    };
    const secondSection: SectionDocument = {
      ...createSection(),
      id: "section-2",
      href: "OPS/chapter-2.xhtml",
      title: "Chapter 2",
      blocks: [
        {
          id: "text-2",
          kind: "text",
          inlines: repeatedText
        }
      ]
    };

    const book: Book = {
      metadata: {
        title: "Paged Demo"
      },
      manifest: [],
      spine: [
        {
          idref: "item-1",
          href: firstSection.href,
          linear: true
        },
        {
          idref: "item-2",
          href: secondSection.href,
          linear: true
        }
      ],
      toc: [],
      sections: [firstSection, secondSection]
    };

    const state = reader as unknown as {
      book: Book;
    };
    state.book = book;

    await reader.render();

    const lastPage = reader.getPaginationInfo().totalPages;
    await reader.goToPage(lastPage);

    expect(reader.getPaginationInfo().currentPage).toBe(lastPage);
    expect(reader.getCurrentLocation()?.spineIndex).toBe(1);
    expect(
      container.querySelector('article[data-section-id="section-2"] canvas.epub-canvas-section')
    ).toBeTruthy();
  });

  it("renders all sections into a continuous document in scroll mode", async () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 260
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 180
    });
    document.body.appendChild(container);

    const reader = new EpubReader({
      container,
      mode: "scroll"
    });

    const firstSection: SectionDocument = {
      ...createSection(),
      id: "section-1",
      href: "OPS/chapter-1.xhtml",
      title: "Chapter 1"
    };
    const secondSection: SectionDocument = {
      ...createSection(),
      id: "section-2",
      href: "OPS/chapter-2.xhtml",
      title: "Chapter 2"
    };

    const book: Book = {
      metadata: {
        title: "Continuous Demo"
      },
      manifest: [],
      spine: [
        { idref: "item-1", href: firstSection.href, linear: true },
        { idref: "item-2", href: secondSection.href, linear: true }
      ],
      toc: [],
      sections: [firstSection, secondSection]
    };

    (reader as unknown as { book: Book }).book = book;
    await reader.render();

    expect(container.querySelectorAll("[data-section-id]").length).toBe(2);
    expect(
      container.querySelector('article[data-section-id="section-1"] canvas.epub-canvas-section')
    ).toBeTruthy();
    expect(
      container.querySelector('article[data-section-id="section-2"] canvas.epub-canvas-section')
    ).toBeTruthy();
  });

  it("window-renders nearby sections in scroll mode instead of rendering the whole book body at once", async () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 260
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 180
    });
    document.body.appendChild(container);

    const reader = new EpubReader({
      container,
      mode: "scroll"
    });

    const sections: SectionDocument[] = Array.from({ length: 6 }, (_, index) => ({
      ...createSection(),
      id: `section-${index + 1}`,
      href: `OPS/chapter-${index + 1}.xhtml`,
      title: `Chapter ${index + 1}`
    }));

    const book: Book = {
      metadata: {
        title: "Windowed Demo"
      },
      manifest: [],
      spine: sections.map((section, index) => ({
        idref: `item-${index + 1}`,
        href: section.href,
        linear: true
      })),
      toc: [],
      sections
    };

    (reader as unknown as { book: Book }).book = book;
    await reader.render();

    expect(container.querySelectorAll("[data-section-id]").length).toBe(6);
    expect(container.querySelectorAll(".epub-section-header h2").length).toBeLessThan(6);
    expect(container.querySelectorAll(".epub-section-virtual").length).toBeGreaterThan(0);
  });

  it("keeps the viewport anchored when the scroll window shifts across later chapters", async () => {
    const originalOffsetTop = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetTop"
    );
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight"
    );

    const beforeOffsets = new Map<string, { top: number; height: number }>([
      ["section-1", { top: 0, height: 400 }],
      ["section-2", { top: 400, height: 400 }],
      ["section-3", { top: 800, height: 400 }],
      ["section-4", { top: 1200, height: 400 }],
      ["section-5", { top: 1600, height: 400 }],
      ["section-6", { top: 2000, height: 400 }]
    ]);
    const afterOffsets = new Map<string, { top: number; height: number }>([
      ["section-1", { top: 0, height: 2000 }],
      ["section-2", { top: 2000, height: 400 }],
      ["section-3", { top: 2400, height: 400 }],
      ["section-4", { top: 2800, height: 400 }],
      ["section-5", { top: 3200, height: 400 }],
      ["section-6", { top: 3600, height: 400 }]
    ]);
    let currentOffsets = beforeOffsets;

    try {
      Object.defineProperty(HTMLElement.prototype, "offsetTop", {
        configurable: true,
        get() {
          const sectionId = this.dataset?.sectionId;
          if (sectionId) {
            return currentOffsets.get(sectionId)?.top ?? 0;
          }
          return originalOffsetTop?.get?.call(this) ?? 0;
        }
      });

      Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get() {
          const sectionId = this.dataset?.sectionId;
          if (sectionId) {
            return currentOffsets.get(sectionId)?.height ?? 0;
          }
          return originalOffsetHeight?.get?.call(this) ?? 0;
        }
      });

      const container = document.createElement("div");
      Object.defineProperty(container, "clientWidth", {
        configurable: true,
        value: 260
      });
      Object.defineProperty(container, "clientHeight", {
        configurable: true,
        value: 180
      });
      Object.defineProperty(container, "scrollTop", {
        configurable: true,
        writable: true,
        value: 0
      });
      document.body.appendChild(container);

      const reader = new EpubReader({
        container,
        mode: "scroll"
      });

      const sections: SectionDocument[] = Array.from({ length: 6 }, (_, index) => ({
        ...createSection(),
        id: `section-${index + 1}`,
        href: `OPS/chapter-${index + 1}.xhtml`,
        title: `Chapter ${index + 1}`
      }));

      const book: Book = {
        metadata: { title: "Window Anchor Demo" },
        manifest: [],
        spine: sections.map((section, index) => ({
          idref: `item-${index + 1}`,
          href: section.href,
          linear: true
        })),
        toc: [],
        sections
      };

      const state = reader as unknown as {
        book: Book;
        locator: { spineIndex: number; progressInSection: number };
        currentSectionIndex: number;
        renderScrollableCanvas: (renderVersion: number) => void;
        syncPositionFromScroll: (emitEvent: boolean) => boolean;
        refreshScrollWindowIfNeeded: () => boolean;
      };
      state.book = book;
      state.currentSectionIndex = 3;
      state.locator = {
        spineIndex: 3,
        progressInSection: 0
      };

      await reader.render();

      container.scrollTop = 1700;
      state.syncPositionFromScroll(false);

      const originalRenderScrollableCanvas = state.renderScrollableCanvas.bind(reader);
      state.renderScrollableCanvas = (renderVersion: number) => {
        currentOffsets = afterOffsets;
        originalRenderScrollableCanvas(renderVersion);
      };

      const refreshed = state.refreshScrollWindowIfNeeded();

      expect(refreshed).toBe(true);
      expect(container.scrollTop).toBe(3300);
      expect(reader.getCurrentLocation()?.spineIndex).toBe(4);
    } finally {
      if (originalOffsetTop) {
        Object.defineProperty(HTMLElement.prototype, "offsetTop", originalOffsetTop);
      }
      if (originalOffsetHeight) {
        Object.defineProperty(
          HTMLElement.prototype,
          "offsetHeight",
          originalOffsetHeight
        );
      }
    }
  });

  it("moves by global pages with next and prev in scroll mode", async () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 260
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 180
    });
    document.body.appendChild(container);

    const reader = new EpubReader({
      container,
      mode: "scroll"
    });

    const repeatedText = Array.from({ length: 24 }, () => ({
      kind: "text" as const,
      text: "This is a long paragraph designed to spill across multiple pages. "
    }));
    const section: SectionDocument = {
      ...createSection(),
      blocks: [
        {
          id: "text-1",
          kind: "text",
          inlines: repeatedText
        }
      ]
    };

    const book: Book = {
      metadata: {
        title: "Paged Demo"
      },
      manifest: [],
      spine: [
        {
          idref: "item-1",
          href: section.href,
          linear: true
        }
      ],
      toc: [],
      sections: [section]
    };

    const state = reader as unknown as {
      book: Book;
    };
    state.book = book;

    await reader.render();

    expect(reader.getPaginationInfo().currentPage).toBe(1);
    await reader.next();
    expect(reader.getPaginationInfo().currentPage).toBe(2);
    await reader.prev();
    expect(reader.getPaginationInfo().currentPage).toBe(1);
  });

  it("recomputes current global page correctly after typography changes in scroll mode", async () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 260
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 180
    });
    document.body.appendChild(container);

    const reader = new EpubReader({
      container,
      mode: "scroll"
    });

    const repeatedText = Array.from({ length: 24 }, () => ({
      kind: "text" as const,
      text: "This is a long paragraph designed to spill across multiple pages. "
    }));
    const firstSection: SectionDocument = {
      ...createSection(),
      id: "section-1",
      href: "OPS/chapter-1.xhtml",
      title: "Chapter 1",
      blocks: [
        {
          id: "text-1",
          kind: "text",
          inlines: repeatedText
        }
      ]
    };
    const secondSection: SectionDocument = {
      ...createSection(),
      id: "section-2",
      href: "OPS/chapter-2.xhtml",
      title: "Chapter 2",
      blocks: [
        {
          id: "text-2",
          kind: "text",
          inlines: repeatedText
        }
      ]
    };

    const book: Book = {
      metadata: {
        title: "Paged Demo"
      },
      manifest: [],
      spine: [
        {
          idref: "item-1",
          href: firstSection.href,
          linear: true
        },
        {
          idref: "item-2",
          href: secondSection.href,
          linear: true
        }
      ],
      toc: [],
      sections: [firstSection, secondSection]
    };

    const state = reader as unknown as {
      book: Book;
    };
    state.book = book;

    await reader.render();
    await reader.goToPage(6);

    const before = reader.getPaginationInfo();
    expect(before.currentPage).toBe(6);

    await reader.setTypography({ fontSize: 24 });

    const after = reader.getPaginationInfo();
    expect(after.totalPages).not.toBe(before.totalPages);
    expect(after.currentPage).toBeGreaterThan(1);
    expect(after.currentPage).toBeLessThanOrEqual(after.totalPages);
  });

  it("updates current page when scroll position changes in scroll mode", async () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 260
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 180
    });
    document.body.appendChild(container);

    const reader = new EpubReader({
      container,
      mode: "scroll"
    });

    const repeatedText = Array.from({ length: 24 }, () => ({
      kind: "text" as const,
      text: "This is a long paragraph designed to spill across multiple pages. "
    }));
    const firstSection: SectionDocument = {
      ...createSection(),
      id: "section-1",
      href: "OPS/chapter-1.xhtml",
      title: "Chapter 1",
      blocks: [{ id: "text-1", kind: "text", inlines: repeatedText }]
    };
    const secondSection: SectionDocument = {
      ...createSection(),
      id: "section-2",
      href: "OPS/chapter-2.xhtml",
      title: "Chapter 2",
      blocks: [{ id: "text-2", kind: "text", inlines: repeatedText }]
    };

    const book: Book = {
      metadata: { title: "Paged Demo" },
      manifest: [],
      spine: [
        { idref: "item-1", href: firstSection.href, linear: true },
        { idref: "item-2", href: secondSection.href, linear: true }
      ],
      toc: [],
      sections: [firstSection, secondSection]
    };

    (reader as unknown as { book: Book }).book = book;
    await reader.render();

    const sectionElements = Array.from(container.querySelectorAll<HTMLElement>("[data-section-id]"));
    Object.defineProperty(sectionElements[0]!, "offsetTop", { configurable: true, value: 0 });
    Object.defineProperty(sectionElements[0]!, "offsetHeight", { configurable: true, value: 360 });
    Object.defineProperty(sectionElements[1]!, "offsetTop", { configurable: true, value: 360 });
    Object.defineProperty(sectionElements[1]!, "offsetHeight", { configurable: true, value: 360 });

    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      writable: true,
      value: 420
    });
    (
      reader as unknown as {
        syncPositionFromScroll(emitEvent: boolean): boolean;
      }
    ).syncPositionFromScroll(true);

    expect(reader.getCurrentLocation()?.spineIndex).toBe(1);
    expect(reader.getPaginationInfo().currentPage).toBeGreaterThan(1);
  });

  it("preserves the current scroll section during passive rerenders in scroll mode", async () => {
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
            return 360;
          }
          return originalOffsetTop?.get?.call(this) ?? 0;
        }
      });

      Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get() {
          const sectionId = this.dataset?.sectionId;
          if (sectionId === "section-1" || sectionId === "section-2") {
            return 360;
          }
          return originalOffsetHeight?.get?.call(this) ?? 0;
        }
      });

      const container = document.createElement("div");
      Object.defineProperty(container, "clientWidth", {
        configurable: true,
        value: 260
      });
      Object.defineProperty(container, "clientHeight", {
        configurable: true,
        value: 180
      });
      Object.defineProperty(container, "scrollTop", {
        configurable: true,
        writable: true,
        value: 0
      });
      document.body.appendChild(container);

      const reader = new EpubReader({
        container,
        mode: "scroll"
      });

      const repeatedText = Array.from({ length: 24 }, () => ({
        kind: "text" as const,
        text: "This is a long paragraph designed to spill across multiple pages. "
      }));
      const firstSection: SectionDocument = {
        ...createSection(),
        id: "section-1",
        href: "OPS/chapter-1.xhtml",
        title: "Chapter 1",
        blocks: [{ id: "text-1", kind: "text", inlines: repeatedText }]
      };
      const secondSection: SectionDocument = {
        ...createSection(),
        id: "section-2",
        href: "OPS/chapter-2.xhtml",
        title: "Chapter 2",
        blocks: [{ id: "text-2", kind: "text", inlines: repeatedText }]
      };

      const book: Book = {
        metadata: { title: "Scroll Preserve Demo" },
        manifest: [],
        spine: [
          { idref: "item-1", href: firstSection.href, linear: true },
          { idref: "item-2", href: secondSection.href, linear: true }
        ],
        toc: [],
        sections: [firstSection, secondSection]
      };

      (reader as unknown as { book: Book }).book = book;
      await reader.render();

      container.scrollTop = 420;
      await reader.setTheme({
        background: "#f7f1e3"
      });

      expect(container.scrollTop).toBe(420);
      expect(reader.getCurrentLocation()?.spineIndex).toBe(1);
    } finally {
      if (originalOffsetTop) {
        Object.defineProperty(HTMLElement.prototype, "offsetTop", originalOffsetTop);
      }
      if (originalOffsetHeight) {
        Object.defineProperty(
          HTMLElement.prototype,
          "offsetHeight",
          originalOffsetHeight
        );
      }
    }
  });
});
