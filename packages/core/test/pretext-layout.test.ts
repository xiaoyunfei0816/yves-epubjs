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
});
