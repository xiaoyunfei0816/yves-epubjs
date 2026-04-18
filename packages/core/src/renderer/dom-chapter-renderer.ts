import type {
  FixedLayoutViewport,
  RenditionLayout,
  Theme,
  TypographyOptions
} from "../model/types";
import type { PreprocessedChapterNode } from "../runtime/chapter-preprocess";
import { buildDomChapterNormalizationCss } from "./dom-chapter-style";
import { scopeDomStyleSheetCss } from "./dom-style-scope";

export type DomChapterRenderInput = {
  sectionId: string;
  sectionHref: string;
  sectionLanguage?: string;
  sectionDirection?: "ltr" | "rtl";
  renditionLayout?: RenditionLayout;
  fixedLayoutViewport?: FixedLayoutViewport;
  fixedLayoutScale?: number;
  fixedLayoutRenderWidth?: number;
  fixedLayoutRenderHeight?: number;
  presentationRole?: "cover" | "image-page";
  presentationImageSrc?: string;
  presentationImageAlt?: string;
  linkedStyleSheets?: Array<{
    href: string;
    text: string;
  }>;
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
      .querySelectorAll(
        ".epub-dom-section, style[data-epub-dom-normalization], style[data-epub-dom-source]"
      )
      .forEach((element) => element.remove());
  }

  createMarkup(input: DomChapterRenderInput): string {
    if (
      (input.presentationRole === "cover" || input.presentationRole === "image-page") &&
      input.presentationImageSrc
    ) {
      return this.createPresentationImageMarkup(input)
    }

    return [
      ...serializeLinkedStyleSheets(input.linkedStyleSheets),
      `<style data-epub-dom-normalization="true">${buildDomChapterNormalizationCss({
        theme: input.theme,
        typography: input.typography,
        fontFamily: input.fontFamily,
        ...(input.renditionLayout ? { renditionLayout: input.renditionLayout } : {}),
        ...(input.presentationRole ? { presentationRole: input.presentationRole } : {})
      })}</style>`,
      `<div class="epub-dom-section${input.presentationRole === "cover" ? " epub-dom-section-cover" : ""}${input.renditionLayout === "pre-paginated" ? " epub-dom-section-fxl" : ""}" data-section-id="${escapeHtmlAttribute(input.sectionId)}" data-section-href="${escapeHtmlAttribute(input.sectionHref)}"${serializeSectionLanguageAttributes(input)}${serializeFixedLayoutAttributes(input)}>`,
      serializePreprocessedChapterNodes(input.nodes, input.resolveAttributeValue),
      "</div>"
    ].join("");
  }

  createPresentationImageMarkup(input: DomChapterRenderInput): string {
    const imageAlt =
      input.presentationImageAlt ?? (input.presentationRole === "cover" ? "Cover" : "")
    const presentationClass =
      input.presentationRole === "cover" ? "epub-dom-cover" : "epub-dom-image-page"

    return [
      ...serializeLinkedStyleSheets(input.linkedStyleSheets),
      `<style data-epub-dom-normalization="true">${buildDomChapterNormalizationCss({
        theme: input.theme,
        typography: input.typography,
        fontFamily: input.fontFamily,
        ...(input.renditionLayout ? { renditionLayout: input.renditionLayout } : {}),
        ...(input.presentationRole ? { presentationRole: input.presentationRole } : {})
      })}</style>`,
      `<div class="epub-dom-section epub-dom-section-${input.presentationRole} ${presentationClass}${input.renditionLayout === "pre-paginated" ? " epub-dom-section-fxl" : ""}" data-section-id="${escapeHtmlAttribute(input.sectionId)}" data-section-href="${escapeHtmlAttribute(input.sectionHref)}"${serializeSectionLanguageAttributes(input)}${serializeFixedLayoutAttributes(input)}>`,
      `<img class="epub-dom-presentation-image" src="${escapeHtmlAttribute(input.presentationImageSrc ?? "")}" alt="${escapeHtmlAttribute(imageAlt)}">`,
      "</div>"
    ].join("")
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
    .flatMap(([name, value]) => {
      const resolvedValue = resolveAttributeValue
        ? resolveAttributeValue({
            tagName: node.tagName,
            attributeName: name,
            value
          })
        : value;
      if (!resolvedValue.trim()) {
        return []
      }
      return [` ${name}="${escapeHtmlAttribute(resolvedValue)}"`]
    })
    .join("");

  if (VOID_HTML_TAGS.has(node.tagName)) {
    return `<${node.tagName}${attributes}>`;
  }

  if (node.tagName === "style") {
    return serializeInlineStyleNode(node, attributes)
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

function serializeLinkedStyleSheets(
  stylesheets: DomChapterRenderInput["linkedStyleSheets"]
): string[] {
  return (stylesheets ?? []).map(
    (stylesheet) =>
      `<style data-epub-dom-source="${escapeHtmlAttribute(stylesheet.href)}">${escapeStyleTagText(scopeDomStyleSheetCss(stylesheet.text))}</style>`
  );
}

function escapeStyleTagText(value: string): string {
  return value.replaceAll("</style", "<\\/style");
}

function serializeInlineStyleNode(
  node: Extract<PreprocessedChapterNode, { kind: "element" }>,
  attributes: string
): string {
  const styleText = node.children
    .map((child) => (child.kind === "text" ? child.text : ""))
    .join("")

  return `<style${attributes}>${escapeStyleTagText(scopeDomStyleSheetCss(styleText))}</style>`
}

function serializeSectionLanguageAttributes(input: DomChapterRenderInput): string {
  return [
    input.sectionLanguage ? ` lang="${escapeHtmlAttribute(input.sectionLanguage)}"` : "",
    input.sectionDirection ? ` dir="${escapeHtmlAttribute(input.sectionDirection)}"` : ""
  ].join("")
}

function serializeFixedLayoutAttributes(input: DomChapterRenderInput): string {
  if (input.renditionLayout !== "pre-paginated" || !input.fixedLayoutViewport) {
    return ""
  }

  const styleAttributes = [
    `--fxl-viewport-width: ${input.fixedLayoutViewport.width}px`,
    `--fxl-viewport-height: ${input.fixedLayoutViewport.height}px`,
    ...(typeof input.fixedLayoutRenderWidth === "number"
      ? [`--fxl-render-width: ${input.fixedLayoutRenderWidth}px`]
      : []),
    ...(typeof input.fixedLayoutRenderHeight === "number"
      ? [`--fxl-render-height: ${input.fixedLayoutRenderHeight}px`]
      : []),
    ...(typeof input.fixedLayoutScale === "number"
      ? [`--fxl-scale: ${input.fixedLayoutScale}`]
      : [])
  ].join("; ")

  return [
    ` data-rendition-layout="pre-paginated"`,
    ` data-fxl-viewport-width="${escapeHtmlAttribute(String(input.fixedLayoutViewport.width))}"`,
    ` data-fxl-viewport-height="${escapeHtmlAttribute(String(input.fixedLayoutViewport.height))}"`,
    typeof input.fixedLayoutScale === "number"
      ? ` data-fxl-scale="${escapeHtmlAttribute(input.fixedLayoutScale.toFixed(4))}"`
      : "",
    styleAttributes ? ` style="${escapeHtmlAttribute(styleAttributes)}"` : ""
  ].join("")
}
