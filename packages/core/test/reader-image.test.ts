import { describe, expect, it, vi } from "vitest";
import { InMemoryResourceContainer } from "../src/container/resource-container";
import type { Book, SectionDocument } from "../src/model/types";
import { EpubReader } from "../src/runtime/reader";

describe("EpubReader image resources", () => {
  it("converts EPUB image resources into object URLs for rendering", async () => {
    const createObjectURL = vi.fn(() => "blob:cover-image");
    const revokeObjectURL = vi.fn();
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;

    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    const container = document.createElement("div");
    const reader = new EpubReader({ container });

    const resources = new InMemoryResourceContainer({
      "OPS/images/cover.png": new Uint8Array([137, 80, 78, 71])
    });

    const imageUrl = (reader as unknown as {
      resources: typeof resources;
      resolveRenderableResourceUrl(path: string): string;
    });

    imageUrl.resources = resources;
    expect(imageUrl.resolveRenderableResourceUrl("OPS/images/cover.png")).toBe(
      "OPS/images/cover.png"
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(imageUrl.resolveRenderableResourceUrl("OPS/images/cover.png")).toBe(
      "blob:cover-image"
    );

    reader.destroy();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:cover-image");

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("uses resolved blob URLs for canvas image rendering and hit testing", async () => {
    const createObjectURL = vi.fn(() => "blob:cover-image");
    const revokeObjectURL = vi.fn();
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;

    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 320
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 320
    });

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
          src: "OPS/images/cover.png",
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

    const resources = new InMemoryResourceContainer({
      "OPS/images/cover.png": new Uint8Array([137, 80, 78, 71])
    });

    (reader as unknown as { book: Book; resources: typeof resources }).book = book;
    (reader as unknown as { book: Book; resources: typeof resources }).resources = resources;
    await reader.render();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 60));
    await Promise.resolve();

    const hit = reader.hitTest({
      x: 160,
      y: 120
    });

    expect(hit?.kind).toBe("image");
    expect(hit && hit.kind === "image" ? hit.src : null).toBe("blob:cover-image");

    reader.destroy();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("patches rendered DOM image resources in place without forcing a scroll rerender", async () => {
    const createObjectURL = vi.fn(() => "blob:dom-cover-image");
    const revokeObjectURL = vi.fn();
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;

    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    const container = document.createElement("div");
    container.innerHTML =
      '<div class="epub-dom-section"><img src="OPS/images/dom-cover.png" alt="Cover"></div>';
    const reader = new EpubReader({ container });
    const renderSpy = vi.spyOn(
      reader as unknown as { renderCurrentSection(renderBehavior?: "relocate" | "preserve"): void },
      "renderCurrentSection"
    );

    const resources = new InMemoryResourceContainer({
      "OPS/images/dom-cover.png": new Uint8Array([137, 80, 78, 71])
    });

    (
      reader as unknown as {
        resources: typeof resources;
        resolveDomResourceUrl(path: string): string;
      }
    ).resources = resources;

    expect(
      (
        reader as unknown as {
          resolveDomResourceUrl(path: string): string;
        }
      ).resolveDomResourceUrl("OPS/images/dom-cover.png")
    ).toBe("OPS/images/dom-cover.png");

    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const image = container.querySelector("img");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(image?.getAttribute("src")).toBe("blob:dom-cover-image");
    expect(renderSpy).not.toHaveBeenCalled();

    reader.destroy();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("rewrites svg image xlink:href resources for dom rendering", async () => {
    const createObjectURL = vi.fn(() => "blob:dom-svg-cover");
    const revokeObjectURL = vi.fn();
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;

    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    const container = document.createElement("div");
    container.innerHTML =
      '<div class="epub-dom-section"><svg><image xlink:href="OPS/images/dom-cover.png"></image></svg></div>';
    const reader = new EpubReader({ container });

    const resources = new InMemoryResourceContainer({
      "OPS/images/dom-cover.png": new Uint8Array([137, 80, 78, 71])
    });

    ;(
      reader as unknown as {
        resources: typeof resources;
        resolveDomResourceUrl(path: string): string;
      }
    ).resources = resources;

    expect(
      (
        reader as unknown as {
          resolveDomResourceUrl(path: string): string;
        }
      ).resolveDomResourceUrl("OPS/images/dom-cover.png")
    ).toBe("OPS/images/dom-cover.png");

    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const image = container.querySelector("image");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(image?.getAttribute("xlink:href")).toBe("blob:dom-svg-cover");

    reader.destroy();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("forces cover sections onto the dom backend and uses the direct cover image", () => {
    const container = document.createElement("div")
    const reader = new EpubReader({ container, mode: "paginated" })
    const section: SectionDocument = {
      id: "section-cover",
      href: "OPS/Text/cover.xhtml",
      title: "Cover",
      presentationRole: "cover",
      anchors: {},
      blocks: []
    }

    ;(
      reader as unknown as {
        book: Book
        chapterRenderInputs: Array<{
          href: string
          content: string
          preprocessed: {
            href: string
            nodes: []
          }
        }>
        resolveChapterRenderDecision(sectionIndex: number): { mode: string; reasons: string[] }
        createDomRenderInput(
          section: SectionDocument,
          input: {
            href: string
            content: string
            preprocessed: {
              href: string
              nodes: []
            }
          }
        ): { presentationImageSrc?: string; presentationRole?: "cover" | "image-page" }
      }
    ).book = {
      metadata: {
        title: "Rust Cover",
        coverImageHref: "OPS/Images/cover.jpg"
      },
      manifest: [],
      spine: [{ idref: "cover", href: section.href, linear: true }],
      toc: [],
      sections: [section]
    }

    const state = reader as unknown as {
      chapterRenderInputs: Array<{
        href: string
        content: string
        preprocessed: {
          href: string
          nodes: []
        }
      }>
      resolveChapterRenderDecision(sectionIndex: number): { mode: string; reasons: string[] }
      createDomRenderInput(
        section: SectionDocument,
        input: {
          href: string
          content: string
          preprocessed: {
            href: string
            nodes: []
          }
        }
      ): { presentationImageSrc?: string; presentationRole?: "cover" | "image-page" }
    }
    state.chapterRenderInputs = [
      {
        href: section.href,
        content: "<html><body></body></html>",
        preprocessed: {
          href: section.href,
          nodes: []
        }
      }
    ]

    expect(state.resolveChapterRenderDecision(0)).toEqual({
      mode: "dom",
      score: 0,
      reasons: ["cover-section"]
    })
    expect(state.createDomRenderInput(section, state.chapterRenderInputs[0]!).presentationRole).toBe(
      "cover"
    )
    expect(
      state.createDomRenderInput(section, state.chapterRenderInputs[0]!).presentationImageSrc
    ).toBe("OPS/Images/cover.jpg")
  })

  it("forces image-only sections onto the dom backend and uses the standalone image", () => {
    const container = document.createElement("div")
    const reader = new EpubReader({ container, mode: "paginated" })
    const section: SectionDocument = {
      id: "section-title-page",
      href: "OPS/text00000.xhtml",
      title: "书名页",
      presentationRole: "image-page",
      anchors: {},
      blocks: [
        {
          id: "title-image-block",
          kind: "text",
          inlines: [{ kind: "image", src: "OPS/Image00000.jpg", alt: "Title image" }]
        }
      ]
    }

    ;(
      reader as unknown as {
        book: Book
        chapterRenderInputs: Array<{
          href: string
          content: string
          preprocessed: {
            href: string
            nodes: []
          }
        }>
        resolveChapterRenderDecision(sectionIndex: number): { mode: string; reasons: string[] }
        createDomRenderInput(
          section: SectionDocument,
          input: {
            href: string
            content: string
            preprocessed: {
              href: string
              nodes: []
            }
          }
        ): { presentationImageSrc?: string; presentationRole?: "cover" | "image-page" }
      }
    ).book = {
      metadata: {
        title: "Quit Smoking"
      },
      manifest: [],
      spine: [{ idref: "title-page", href: section.href, linear: true }],
      toc: [],
      sections: [section]
    }

    const state = reader as unknown as {
      chapterRenderInputs: Array<{
        href: string
        content: string
        preprocessed: {
          href: string
          nodes: []
        }
      }>
      resolveChapterRenderDecision(sectionIndex: number): { mode: string; reasons: string[] }
      createDomRenderInput(
        section: SectionDocument,
        input: {
          href: string
          content: string
          preprocessed: {
            href: string
            nodes: []
          }
        }
      ): { presentationImageSrc?: string; presentationRole?: "cover" | "image-page" }
    }
    state.chapterRenderInputs = [
      {
        href: section.href,
        content: "<html><body></body></html>",
        preprocessed: {
          href: section.href,
          nodes: []
        }
      }
    ]

    expect(state.resolveChapterRenderDecision(0)).toEqual({
      mode: "dom",
      score: 0,
      reasons: ["image-page-section"]
    })
    expect(state.createDomRenderInput(section, state.chapterRenderInputs[0]!).presentationRole).toBe(
      "image-page"
    )
    expect(
      state.createDomRenderInput(section, state.chapterRenderInputs[0]!).presentationImageSrc
    ).toBe("OPS/Image00000.jpg")
  })

  it("starts at the first cover page when leading dom image sections have not measured yet", async () => {
    const container = document.createElement("div")
    container.innerHTML = '<article class="placeholder-page">Waiting</article>'
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 320
    })
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 400
    })
    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0
    })
    Object.defineProperty(container, "scrollLeft", {
      configurable: true,
      writable: true,
      value: 0
    })

    const reader = new EpubReader({ container, mode: "scroll" })
    const coverSection: SectionDocument = {
      id: "section-1",
      href: "OPS/cover.xhtml",
      title: "Cover",
      presentationRole: "cover",
      anchors: {},
      blocks: []
    }
    const titleSection: SectionDocument = {
      id: "section-2",
      href: "OPS/title.xhtml",
      title: "Title Page",
      presentationRole: "image-page",
      anchors: {},
      blocks: [
        {
          id: "title-image",
          kind: "image",
          src: "OPS/title.jpg",
          alt: "Title"
        }
      ]
    }
    const chapterSection: SectionDocument = {
      id: "section-3",
      href: "OPS/chapter-1.xhtml",
      title: "Chapter 1",
      anchors: {},
      blocks: [
        {
          id: "text-1",
          kind: "text",
          inlines: [{ kind: "text", text: "First chapter text." }]
        }
      ]
    }

    ;(
      reader as unknown as {
        book: Book
        chapterRenderInputs: Array<{
          href: string
          content: string
          preprocessed: {
            href: string
            nodes: []
          }
        }>
      }
    ).book = {
      metadata: {
        title: "Quit Smoking",
        coverImageHref: "OPS/cover.jpg"
      },
      manifest: [],
      spine: [
        { idref: "cover", href: coverSection.href, linear: true },
        { idref: "title", href: titleSection.href, linear: true },
        { idref: "chapter-1", href: chapterSection.href, linear: true }
      ],
      toc: [],
      sections: [coverSection, titleSection, chapterSection]
    }

    ;(
      reader as unknown as {
        chapterRenderInputs: Array<{
          href: string
          content: string
          preprocessed: {
            href: string
            nodes: []
          }
        }>
      }
    ).chapterRenderInputs = [
      {
        href: coverSection.href,
        content: "<html><body></body></html>",
        preprocessed: { href: coverSection.href, nodes: [] }
      },
      {
        href: titleSection.href,
        content: "<html><body></body></html>",
        preprocessed: { href: titleSection.href, nodes: [] }
      },
      {
        href: chapterSection.href,
        content: "<html><body></body></html>",
        preprocessed: { href: chapterSection.href, nodes: [] }
      }
    ]

    await reader.setTheme({ background: "#fffaf0" })
    await reader.setTypography({ fontSize: 18 })
    await reader.setMode("scroll")
    await reader.render()

    expect(reader.getCurrentLocation()).toEqual({
      spineIndex: 0,
      progressInSection: 0
    })
    expect(reader.getPaginationInfo()).toEqual({
      currentPage: 1,
      totalPages: 3
    })
    expect(container.scrollTop).toBe(0)
    expect(container.querySelector(".placeholder-page")).toBeNull()
    expect(reader.getRenderMetrics().backend).toBe("dom")
  })
});
