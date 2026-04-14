import { describe, expect, it } from "vitest";
import { LayoutEngine } from "../src/layout/layout-engine";
import type { Book, SectionDocument } from "../src/model/types";
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

  it("renders pretext lines into the reader DOM output", async () => {
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

    expect(container.querySelectorAll(".epub-pretext-line").length).toBeGreaterThan(1);
    expect(container.textContent).toContain("This paragraph is rendered through pretext.");
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
    expect(container.textContent).toContain("Chapter 2");

    await reader.goToLocation({
      spineIndex: 1,
      progressInSection: 1
    });

    expect(reader.getPaginationInfo().currentPage).toBe(pagination.totalPages);
    expect(container.textContent).toContain("Chapter 2");
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
    expect(container.textContent).toContain("Chapter 2");
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
    expect(container.textContent).toContain("Chapter 1");
    expect(container.textContent).toContain("Chapter 2");
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
});
