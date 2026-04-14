import { XMLParser } from "fast-xml-parser";
import {
  normalizeResourcePath,
  resolveResourcePath
} from "../container/resource-path";
import { parseInlineContent } from "./inline-parser";
import type {
  BlockNode,
  ImageBlock,
  ListItemBlock,
  SectionDocument,
  TableCell,
  TableRow
} from "../model/types";

type XmlNode = Record<string, unknown>;

const xmlParser = new XMLParser({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  preserveOrder: false
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function readTextContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(readTextContent).join("");
  }

  if (value && typeof value === "object") {
    return Object.entries(value as XmlNode)
      .filter(([key]) => !key.startsWith("@_"))
      .map(([, child]) => readTextContent(child))
      .join("");
  }

  return "";
}

class XhtmlBlockParser {
  private blockCounter = 0;
  private listItemCounter = 0;
  private rowCounter = 0;
  private cellCounter = 0;
  readonly anchors: Record<string, string> = {};

  constructor(private readonly sectionHref: string) {}

  parseDocument(xml: string): SectionDocument {
    const parsed = xmlParser.parse(xml) as XmlNode;
    const htmlNode = (parsed.html as XmlNode | undefined) ?? parsed;
    const bodyNode =
      (htmlNode.body as XmlNode | undefined) ??
      (Array.isArray(htmlNode.body) ? (htmlNode.body[0] as XmlNode | undefined) : undefined);
    const lang =
      (typeof htmlNode["@_xml:lang"] === "string" && htmlNode["@_xml:lang"]) ||
      (typeof htmlNode["@_lang"] === "string" && htmlNode["@_lang"]) ||
      undefined;
    const title = this.extractDocumentTitle(htmlNode);
    const blocks = bodyNode ? this.parseContainerNode(bodyNode) : [];

    const section: SectionDocument = {
      id: this.createBlockId("section"),
      href: this.sectionHref,
      blocks,
      anchors: this.anchors
    };

    if (title) {
      section.title = title;
    }
    if (lang) {
      section.lang = lang;
    }

    return section;
  }

  private extractDocumentTitle(htmlNode: XmlNode): string | undefined {
    const headNode =
      (htmlNode.head as XmlNode | undefined) ??
      (Array.isArray(htmlNode.head) ? (htmlNode.head[0] as XmlNode | undefined) : undefined);

    if (!headNode) {
      return undefined;
    }

    const titleText = readTextContent(headNode.title).replace(/\s+/g, " ").trim();
    return titleText || undefined;
  }

  private createBlockId(prefix: string): string {
    this.blockCounter += 1;
    return `${prefix}-${this.blockCounter}`;
  }

  private createListItemId(): string {
    this.listItemCounter += 1;
    return `list-item-${this.listItemCounter}`;
  }

  private createRowId(): string {
    this.rowCounter += 1;
    return `table-row-${this.rowCounter}`;
  }

  private createCellId(): string {
    this.cellCounter += 1;
    return `table-cell-${this.cellCounter}`;
  }

  private registerAnchor(node: XmlNode, blockId: string): void {
    if (typeof node["@_id"] === "string" && node["@_id"].trim()) {
      this.anchors[node["@_id"].trim()] = blockId;
    }
  }

  private parseContainerNode(node: XmlNode): BlockNode[] {
    const blocks: BlockNode[] = [];

    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith("@_")) {
        continue;
      }

      const children = asArray(value);
      for (const child of children) {
        const normalizedNode =
          child && typeof child === "object"
            ? (child as XmlNode)
            : { "#text": child };

        blocks.push(...this.parseElement(key, normalizedNode));
      }
    }

    return blocks;
  }

  private parseElement(tagName: string, node: XmlNode): BlockNode[] {
    if (tagName === "body" || tagName === "section" || tagName === "article" || tagName === "div" || tagName === "main") {
      return this.parseContainerNode(node);
    }

    if (/^h[1-6]$/.test(tagName)) {
      const blockId = this.createBlockId("heading");
      this.registerAnchor(node, blockId);
      return [
        {
          id: blockId,
          kind: "heading",
          level: Number(tagName[1]) as 1 | 2 | 3 | 4 | 5 | 6,
          inlines: parseInlineContent(node, this.sectionHref)
        }
      ];
    }

    if (tagName === "p") {
      const blockId = this.createBlockId("text");
      this.registerAnchor(node, blockId);
      return [
        {
          id: blockId,
          kind: "text",
          inlines: parseInlineContent(node, this.sectionHref)
        }
      ];
    }

    if (tagName === "blockquote") {
      const blockId = this.createBlockId("quote");
      this.registerAnchor(node, blockId);
      return [
        {
          id: blockId,
          kind: "quote",
          blocks: this.parseContainerNode(node)
        }
      ];
    }

    if (tagName === "pre") {
      const blockId = this.createBlockId("code");
      this.registerAnchor(node, blockId);
      const codeNode =
        (node.code as XmlNode | undefined) ??
        (Array.isArray(node.code) ? (node.code[0] as XmlNode | undefined) : undefined);
      const language =
        typeof codeNode?.["@_data-language"] === "string"
          ? codeNode["@_data-language"]
          : typeof codeNode?.["@_class"] === "string"
            ? codeNode["@_class"]
            : undefined;

      const codeBlock: BlockNode = {
        id: blockId,
        kind: "code",
        text: readTextContent(codeNode ?? node).trim()
      };

      if (language) {
        codeBlock.language = language;
      }

      return [codeBlock];
    }

    if (tagName === "img") {
      const imageBlock = this.parseImageBlock(node);
      return imageBlock ? [imageBlock] : [];
    }

    if (tagName === "hr") {
      const blockId = this.createBlockId("thematic-break");
      this.registerAnchor(node, blockId);
      return [
        {
          id: blockId,
          kind: "thematic-break"
        }
      ];
    }

    if (tagName === "ul" || tagName === "ol") {
      const blockId = this.createBlockId("list");
      this.registerAnchor(node, blockId);
      const itemNodes = asArray(node.li as XmlNode | XmlNode[] | undefined);
      const items: ListItemBlock[] = itemNodes.map((itemNode) => ({
        id: this.createListItemId(),
        blocks: this.parseListItem(itemNode)
      }));

      const listBlock: BlockNode = {
        id: blockId,
        kind: "list",
        ordered: tagName === "ol",
        items
      };

      if (tagName === "ol" && typeof node["@_start"] === "string") {
        const start = Number(node["@_start"]);
        if (!Number.isNaN(start)) {
          listBlock.start = start;
        }
      }

      return [listBlock];
    }

    if (tagName === "table") {
      const blockId = this.createBlockId("table");
      this.registerAnchor(node, blockId);
      return [
        {
          id: blockId,
          kind: "table",
          rows: this.parseTableRows(node)
        }
      ];
    }

    return [];
  }

  private parseImageBlock(node: XmlNode): ImageBlock | null {
    const src = typeof node["@_src"] === "string" ? node["@_src"] : undefined;

    if (!src) {
      return null;
    }

    const blockId = this.createBlockId("image");
    this.registerAnchor(node, blockId);
    const imageBlock: ImageBlock = {
      id: blockId,
      kind: "image",
      src: resolveResourcePath(this.sectionHref, src)
    };

    if (typeof node["@_alt"] === "string" && node["@_alt"].trim()) {
      imageBlock.alt = node["@_alt"].trim();
    }
    if (typeof node["@_title"] === "string" && node["@_title"].trim()) {
      imageBlock.title = node["@_title"].trim();
    }
    if (typeof node["@_width"] === "string") {
      const width = Number(node["@_width"]);
      if (!Number.isNaN(width)) {
        imageBlock.width = width;
      }
    }
    if (typeof node["@_height"] === "string") {
      const height = Number(node["@_height"]);
      if (!Number.isNaN(height)) {
        imageBlock.height = height;
      }
    }

    return imageBlock;
  }

  private parseListItem(node: XmlNode): BlockNode[] {
    const blocks = this.parseContainerNode(node);
    if (blocks.length > 0) {
      return blocks;
    }

    const parsedInlines = parseInlineContent(node, this.sectionHref);
    if (parsedInlines.length === 0) {
      return [];
    }

    return [
      {
        id: this.createBlockId("text"),
        kind: "text",
        inlines: parsedInlines
      }
    ];
  }

  private parseTableRows(node: XmlNode): TableRow[] {
    const rows: TableRow[] = [];
    const rowContainers = [node.thead, node.tbody, node.tfoot, node];

    for (const container of rowContainers) {
      for (const rowNode of asArray(container as XmlNode | XmlNode[] | undefined)) {
        if (!rowNode || typeof rowNode !== "object") {
          continue;
        }

        for (const trNode of asArray((rowNode as XmlNode).tr as XmlNode | XmlNode[] | undefined)) {
          rows.push({
            id: this.createRowId(),
            cells: this.parseTableCells(trNode)
          });
        }
      }
    }

    return rows;
  }

  private parseTableCells(node: XmlNode): TableCell[] {
    const cellEntries: Array<[string, XmlNode]> = [];

    for (const key of ["th", "td"] as const) {
      for (const cellNode of asArray(node[key] as XmlNode | XmlNode[] | undefined)) {
        cellEntries.push([key, cellNode]);
      }
    }

    return cellEntries.map(([tagName, cellNode]) => {
      const blocks = this.parseContainerNode(cellNode);
      const cell: TableCell = {
        id: this.createCellId(),
        blocks:
          blocks.length > 0
            ? blocks
            : [
                {
                  id: this.createBlockId("text"),
                  kind: "text",
                  inlines: parseInlineContent(cellNode, this.sectionHref)
                }
              ]
      };

      if (tagName === "th") {
        cell.header = true;
      }
      if (typeof cellNode["@_colspan"] === "string") {
        const colSpan = Number(cellNode["@_colspan"]);
        if (!Number.isNaN(colSpan)) {
          cell.colSpan = colSpan;
        }
      }
      if (typeof cellNode["@_rowspan"] === "string") {
        const rowSpan = Number(cellNode["@_rowspan"]);
        if (!Number.isNaN(rowSpan)) {
          cell.rowSpan = rowSpan;
        }
      }

      return cell;
    });
  }
}

export function parseXhtmlDocument(
  xml: string,
  sectionHref: string
): SectionDocument {
  const parser = new XhtmlBlockParser(normalizeResourcePath(sectionHref));
  return parser.parseDocument(xml);
}
