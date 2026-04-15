import type { Theme, TypographyOptions } from "../model/types";
import type { PreprocessedChapterNode } from "../runtime/chapter-preprocess";
import { buildDomChapterNormalizationCss } from "./dom-chapter-style";

export type DomChapterRenderInput = {
  sectionId: string;
  sectionHref: string;
  nodes: PreprocessedChapterNode[];
  theme: Theme;
  typography: TypographyOptions;
  fontFamily: string;
  resolveAttributeValue?: (input: {
    tagName: string;
    attributeName: string;
    value: string;
  }) => string;
};

export class DomChapterRenderer {
  render(container: HTMLElement, input: DomChapterRenderInput): void {
    container.innerHTML = this.createMarkup(input);
  }

  clear(container: HTMLElement): void {
    container
      .querySelectorAll(".epub-dom-section, style[data-epub-dom-normalization]")
      .forEach((element) => element.remove());
  }

  createMarkup(input: DomChapterRenderInput): string {
    return [
      `<style data-epub-dom-normalization="true">${buildDomChapterNormalizationCss({
        theme: input.theme,
        typography: input.typography,
        fontFamily: input.fontFamily
      })}</style>`,
      `<div class="epub-dom-section" data-section-id="${escapeHtmlAttribute(input.sectionId)}" data-section-href="${escapeHtmlAttribute(input.sectionHref)}">`,
      serializePreprocessedChapterNodes(input.nodes, input.resolveAttributeValue),
      "</div>"
    ].join("");
  }
}

const VOID_HTML_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr"
]);

function serializePreprocessedChapterNodes(
  nodes: PreprocessedChapterNode[],
  resolveAttributeValue?: DomChapterRenderInput["resolveAttributeValue"]
): string {
  return nodes
    .map((node) => serializePreprocessedChapterNode(node, resolveAttributeValue))
    .join("");
}

function serializePreprocessedChapterNode(
  node: PreprocessedChapterNode,
  resolveAttributeValue?: DomChapterRenderInput["resolveAttributeValue"]
): string {
  if (node.kind === "text") {
    return escapeHtmlText(node.text);
  }

  const attributes = Object.entries(node.attributes)
    .map(([name, value]) => {
      const resolvedValue = resolveAttributeValue
        ? resolveAttributeValue({
            tagName: node.tagName,
            attributeName: name,
            value
          })
        : value;
      return ` ${name}="${escapeHtmlAttribute(resolvedValue)}"`;
    })
    .join("");

  if (VOID_HTML_TAGS.has(node.tagName)) {
    return `<${node.tagName}${attributes}>`;
  }

  return `<${node.tagName}${attributes}>${serializePreprocessedChapterNodes(
    node.children,
    resolveAttributeValue
  )}</${node.tagName}>`;
}

function escapeHtmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtmlText(value).replaceAll('"', "&quot;");
}
