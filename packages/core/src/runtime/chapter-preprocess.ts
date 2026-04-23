import {
  getHtmlNodeChildren,
  getHtmlTagName,
  isHtmlElementNode,
  isHtmlTextNode,
  type HtmlDomElement,
  type HtmlDomNode
} from "../parser/html-dom-adapter";
import { parseXhtmlDomDocument } from "../parser/xhtml-dom-parser";

export type PreprocessedChapterNode =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "element";
      tagName: string;
      attributes: Record<string, string>;
      children: PreprocessedChapterNode[];
    };

export type PreprocessedChapter = {
  href: string;
  title?: string;
  lang?: string;
  dir?: "ltr" | "rtl";
  rootTagName?: string;
  htmlAttributes?: Record<string, string>;
  bodyAttributes?: Record<string, string>;
  nodes: PreprocessedChapterNode[];
};

export function preprocessChapterDocument(input: {
  href: string;
  content: string;
}): PreprocessedChapter {
  const parsed = parseXhtmlDomDocument(input.content);
  const root = parsed.bodyElement ?? parsed.htmlElement;
  const htmlAttributes = parsed.htmlElement
    ? normalizeRootAttributes(parsed.htmlElement.attribs)
    : {};
  const bodyAttributes = parsed.bodyElement
    ? normalizeRootAttributes(parsed.bodyElement.attribs)
    : {};

  return {
    href: input.href,
    ...(parsed.title ? { title: parsed.title } : {}),
    ...(parsed.lang ? { lang: parsed.lang } : {}),
    ...(parsed.dir ? { dir: parsed.dir } : {}),
    ...(root ? { rootTagName: getHtmlTagName(root) } : {}),
    ...(Object.keys(htmlAttributes).length > 0 ? { htmlAttributes } : {}),
    ...(Object.keys(bodyAttributes).length > 0 ? { bodyAttributes } : {}),
    nodes: root ? preprocessChapterChildren(root) : []
  };
}

function preprocessChapterChildren(node: HtmlDomElement): PreprocessedChapterNode[] {
  const normalizedChildren: PreprocessedChapterNode[] = [];

  for (const child of getHtmlNodeChildren(node)) {
    const normalizedChild = preprocessChapterNode(child);
    if (normalizedChild) {
      normalizedChildren.push(normalizedChild);
    }
  }

  return normalizedChildren;
}

function preprocessChapterNode(node: HtmlDomNode): PreprocessedChapterNode | null {
  if (isHtmlTextNode(node)) {
    if (!node.data.trim()) {
      return null;
    }

    return {
      kind: "text",
      text: node.data
    };
  }

  if (!isHtmlElementNode(node)) {
    return null;
  }

  if (isUnsafeChapterTag(getHtmlTagName(node))) {
    return null
  }

  return {
    kind: "element",
    tagName: getHtmlTagName(node),
    attributes: normalizeAttributes(node.attribs),
    children: preprocessChapterChildren(node)
  };
}

function normalizeAttributes(attributes: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [name, value] of Object.entries(attributes)) {
    if (isUnsafeAttributeName(name)) {
      continue
    }

    const trimmedValue = value.trim();
    if (!trimmedValue) {
      continue;
    }

    normalized[name.toLowerCase()] = trimmedValue;
  }

  return normalized;
}

function normalizeRootAttributes(attributes: Record<string, string>): Record<string, string> {
  const normalized = normalizeAttributes(attributes);
  const safeRootAttributes: Record<string, string> = {};

  for (const [name, value] of Object.entries(normalized)) {
    if (isSupportedRootAttributeName(name)) {
      safeRootAttributes[name] = value;
    }
  }

  return safeRootAttributes;
}

function isUnsafeChapterTag(tagName: string): boolean {
  return tagName.trim().toLowerCase() === "script"
}

function isUnsafeAttributeName(attributeName: string): boolean {
  return attributeName.trim().toLowerCase().startsWith("on")
}

function isSupportedRootAttributeName(attributeName: string): boolean {
  const normalized = attributeName.trim().toLowerCase();
  return (
    normalized === "id" ||
    normalized === "class" ||
    normalized === "style" ||
    normalized === "lang" ||
    normalized === "xml:lang" ||
    normalized === "dir"
  );
}
