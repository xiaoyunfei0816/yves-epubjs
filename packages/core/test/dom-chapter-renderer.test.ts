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
    expect(css).toContain(".epub-dom-section table {");
    expect(css).toContain(".epub-dom-section a {");
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
});
