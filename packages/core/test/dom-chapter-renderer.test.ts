import { describe, expect, it } from "vitest";
import { DomChapterRenderer, buildDomChapterNormalizationCss } from "../src";

describe("DomChapterRenderer", () => {
  it("mounts and clears a dom chapter section", () => {
    const container = document.createElement("div");
    const renderer = new DomChapterRenderer();

    renderer.render(container, {
      sectionId: "section-1",
      sectionHref: "OPS/chapter.xhtml",
      theme: {
        color: "#1f2328",
        background: "#fffdf7"
      },
      typography: {
        fontSize: 18,
        lineHeight: 1.6,
        paragraphSpacing: 12
      },
      fontFamily: '"Iowan Old Style", serif',
      nodes: [
        {
          kind: "element",
          tagName: "section",
          attributes: {},
          children: [
            {
              kind: "element",
              tagName: "p",
              attributes: {},
              children: [{ kind: "text", text: "Hello" }]
            }
          ]
        }
      ]
    });

    expect(container.querySelector(".epub-dom-section")).toBeTruthy();
    expect(container.querySelector("style[data-epub-dom-normalization='true']")).toBeTruthy();
    expect(container.textContent).toContain("Hello");

    renderer.clear(container);

    expect(container.querySelector(".epub-dom-section")).toBeFalsy();
    expect(container.querySelector("style[data-epub-dom-normalization='true']")).toBeFalsy();
  });

  it("injects linked stylesheet text before normalization css and clears it", () => {
    const container = document.createElement("div");
    const renderer = new DomChapterRenderer();

    renderer.render(container, {
      sectionId: "section-1",
      sectionHref: "OPS/chapter.xhtml",
      linkedStyleSheets: [
        {
          href: "OPS/styles/chapter.css",
          text: ".badge { height: 1.1em; }"
        }
      ],
      theme: {
        color: "#1f2328",
        background: "#fffdf7"
      },
      typography: {
        fontSize: 18,
        lineHeight: 1.6,
        paragraphSpacing: 12
      },
      fontFamily: '"Iowan Old Style", serif',
      nodes: [
        {
          kind: "element",
          tagName: "p",
          attributes: {},
          children: [{ kind: "text", text: "Hello" }]
        }
      ]
    });

    const sourceStyle = container.querySelector("style[data-epub-dom-source='OPS/styles/chapter.css']");
    const normalizationStyle = container.querySelector("style[data-epub-dom-normalization='true']");

    expect(sourceStyle?.textContent).toContain(".badge { height: 1.1em; }");
    expect(sourceStyle?.compareDocumentPosition(normalizationStyle!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );

    renderer.clear(container);

    expect(container.querySelector("style[data-epub-dom-source]")).toBeFalsy();
  });

  it("builds normalized css for theme and typography constraints", () => {
    const css = buildDomChapterNormalizationCss({
      theme: {
        color: "#1f2328",
        background: "#fffdf7"
      },
      typography: {
        fontSize: 18,
        lineHeight: 1.6,
        paragraphSpacing: 12
      },
      fontFamily: '"Iowan Old Style", serif'
    });

    expect(css).toContain("font-size: 18px;");
    expect(css).toContain("line-height: 1.6;");
    expect(css).toContain("font-family: \"Iowan Old Style\", serif;");
    expect(css).toContain("--reader-side-padding: 8px;");
    expect(css).toContain("--reader-link-color: #1b4b72;");
    expect(css).toContain("--reader-caption-color: #475569;");
    expect(css).toContain(".epub-dom-section table {");
    expect(css).toContain(".epub-dom-section a {");
    expect(css).toContain(".epub-dom-section figcaption, .epub-dom-section caption {");
    expect(css).toContain(".epub-dom-section mark {");
    expect(css).toContain(".epub-dom-section hr {");
    expect(css).toContain("padding-left: var(--reader-quote-accent-gap);");
  });

  it("rewrites resolved attribute values while serializing dom chapters", () => {
    const renderer = new DomChapterRenderer();

    const markup = renderer.createMarkup({
      sectionId: "section-1",
      sectionHref: "OPS/chapter.xhtml",
      theme: {
        color: "#1f2328",
        background: "#fffdf7"
      },
      typography: {
        fontSize: 18,
        lineHeight: 1.6,
        paragraphSpacing: 12
      },
      fontFamily: '"Iowan Old Style", serif',
      resolveAttributeValue: ({ tagName, attributeName, value }) =>
        tagName === "img" && attributeName === "src"
          ? `blob:${value}`
          : value,
      nodes: [
        {
          kind: "element",
          tagName: "img",
          attributes: {
            src: "OPS/images/cover.jpg",
            alt: "Cover"
          },
          children: []
        }
      ]
    });

    expect(markup).toContain('src="blob:OPS/images/cover.jpg"');
    expect(markup).toContain('alt="Cover"');
  });

  it("adds cover styling hooks for cover sections", () => {
    const renderer = new DomChapterRenderer()

    const markup = renderer.createMarkup({
      sectionId: "section-cover",
      sectionHref: "OPS/cover.xhtml",
      presentationRole: "cover",
      presentationImageSrc: "blob:cover-image",
      theme: {
        color: "#1f2328",
        background: "#fffdf7"
      },
      typography: {
        fontSize: 18,
        lineHeight: 1.6,
        paragraphSpacing: 12
      },
      fontFamily: '"Iowan Old Style", serif',
      nodes: [
        {
          kind: "element",
          tagName: "img",
          attributes: {
            src: "OPS/images/cover.jpg",
            alt: "Cover"
          },
          children: []
        }
      ]
    })

    expect(markup).toContain("epub-dom-section epub-dom-section-cover epub-dom-cover")
    expect(markup).toContain('class="epub-dom-presentation-image"')
    expect(markup).toContain('src="blob:cover-image"')
    expect(markup).toContain(".epub-dom-section-cover img {")
    expect(markup).toContain("width: 100%;")
  })

  it("renders standalone image pages as centered presentation images", () => {
    const renderer = new DomChapterRenderer()

    const markup = renderer.createMarkup({
      sectionId: "section-image-page",
      sectionHref: "OPS/title.xhtml",
      presentationRole: "image-page",
      presentationImageSrc: "blob:title-image",
      theme: {
        color: "#1f2328",
        background: "#fffdf7"
      },
      typography: {
        fontSize: 18,
        lineHeight: 1.6,
        paragraphSpacing: 12
      },
      fontFamily: '"Iowan Old Style", serif',
      nodes: []
    })

    expect(markup).toContain("epub-dom-section-image-page epub-dom-image-page")
    expect(markup).toContain('src="blob:title-image"')
    expect(markup).toContain(".epub-dom-section-image-page img {")
  })

  it("adds fixed-layout sizing hooks for pre-paginated sections", () => {
    const renderer = new DomChapterRenderer()

    const markup = renderer.createMarkup({
      sectionId: "section-fxl",
      sectionHref: "OPS/fxl.xhtml",
      renditionLayout: "pre-paginated",
      fixedLayoutViewport: {
        width: 1200,
        height: 1600
      },
      fixedLayoutRenderWidth: 405,
      fixedLayoutRenderHeight: 540,
      fixedLayoutScale: 0.3375,
      theme: {
        color: "#1f2328",
        background: "#fffdf7"
      },
      typography: {
        fontSize: 18,
        lineHeight: 1.6,
        paragraphSpacing: 12
      },
      fontFamily: '"Iowan Old Style", serif',
      nodes: [
        {
          kind: "element",
          tagName: "div",
          attributes: {},
          children: [{ kind: "text", text: "Fixed layout page" }]
        }
      ]
    })

    expect(markup).toContain("epub-dom-section-fxl")
    expect(markup).toContain('data-rendition-layout="pre-paginated"')
    expect(markup).toContain('data-fxl-viewport-width="1200"')
    expect(markup).toContain('--fxl-render-width: 405px')
    expect(markup).toContain('--fxl-render-height: 540px')
    expect(markup).toContain(".epub-dom-section-fxl {")
  })
});
