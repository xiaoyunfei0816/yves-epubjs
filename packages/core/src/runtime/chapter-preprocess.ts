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
  rootTagName?: string;
  nodes: PreprocessedChapterNode[];
};

export function preprocessChapterDocument(input: {
  href: string;
  content: string;
}): PreprocessedChapter {
  const parsed = parseXhtmlDomDocument(input.content);
  const root = parsed.bodyElement ?? parsed.htmlElement;

  return {
    href: input.href,
    ...(parsed.title ? { title: parsed.title } : {}),
    ...(parsed.lang ? { lang: parsed.lang } : {}),
    ...(root ? { rootTagName: getHtmlTagName(root) } : {}),
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
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      continue;
    }

    normalized[name.toLowerCase()] = trimmedValue;
  }

  return normalized;
}
