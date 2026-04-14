import { describe, expect, it } from "vitest";
import type {
  BlockNode,
  InlineNode,
  SectionDocument,
  TableBlock
} from "../src/model/types";

function serializeSection(section: SectionDocument): string {
  return JSON.stringify(section, null, 2);
}

describe("content model", () => {
  it("supports a section document composed of heterogeneous block nodes", () => {
    const heading: BlockNode = {
      id: "heading-1",
      kind: "heading",
      level: 1,
      inlines: [{ kind: "text", text: "Chapter 1" }]
    };

    const paragraph: BlockNode = {
      id: "paragraph-1",
      kind: "text",
      style: {
        textAlign: "justify",
        lineHeight: 1.7
      },
      inlines: [
        { kind: "text", text: "Alice " },
        { kind: "strong", children: [{ kind: "text", text: "opened" }] },
        { kind: "text", text: " the door." }
      ]
    };

    const section: SectionDocument = {
      id: "section-1",
      href: "OPS/chapter-1.xhtml",
      title: "Chapter 1",
      lang: "en",
      blocks: [heading, paragraph],
      anchors: {
        intro: "heading-1"
      }
    };

    expect(section.blocks).toHaveLength(2);
    expect(section.anchors.intro).toBe("heading-1");
    expect(serializeSection(section)).toContain("\"kind\": \"heading\"");
    expect(serializeSection(section)).toContain("\"kind\": \"text\"");
  });

  it("supports nested inline structures for links, emphasis, and images", () => {
    const paragraph: BlockNode = {
      id: "paragraph-inline",
      kind: "text",
      inlines: [
        { kind: "text", text: "Visit " },
        {
          kind: "link",
          href: "OPS/notes.xhtml#note-1",
          children: [
            { kind: "emphasis", children: [{ kind: "text", text: "note 1" }] }
          ]
        },
        { kind: "text", text: " or inspect " },
        { kind: "image", src: "OPS/images/cover.png", alt: "Cover" }
      ]
    };

    const inlines = paragraph.inlines as InlineNode[];

    expect(inlines[1]).toEqual({
      kind: "link",
      href: "OPS/notes.xhtml#note-1",
      children: [
        {
          kind: "emphasis",
          children: [{ kind: "text", text: "note 1" }]
        }
      ]
    });
    expect(inlines[3]).toEqual({
      kind: "image",
      src: "OPS/images/cover.png",
      alt: "Cover"
    });
  });

  it("supports complex blocks like lists, quotes, code, tables, and thematic breaks", () => {
    const table: TableBlock = {
      id: "table-1",
      kind: "table",
      rows: [
        {
          id: "row-1",
          cells: [
            {
              id: "cell-1",
              header: true,
              blocks: [
                {
                  id: "text-h1",
                  kind: "text",
                  inlines: [{ kind: "text", text: "Name" }]
                }
              ]
            }
          ]
        }
      ]
    };

    const section: SectionDocument = {
      id: "section-complex",
      href: "OPS/appendix.xhtml",
      blocks: [
        {
          id: "list-1",
          kind: "list",
          ordered: true,
          start: 3,
          items: [
            {
              id: "item-1",
              blocks: [
                {
                  id: "text-1",
                  kind: "text",
                  inlines: [{ kind: "text", text: "First item" }]
                }
              ]
            }
          ]
        },
        {
          id: "quote-1",
          kind: "quote",
          attribution: "Lewis Carroll",
          blocks: [
            {
              id: "quote-text",
              kind: "text",
              inlines: [{ kind: "text", text: "Curiouser and curiouser!" }]
            }
          ]
        },
        {
          id: "code-1",
          kind: "code",
          language: "txt",
          text: "print('alice')"
        },
        table,
        {
          id: "hr-1",
          kind: "thematic-break"
        }
      ],
      anchors: {}
    };

    expect(section.blocks[0]?.kind).toBe("list");
    expect(section.blocks[1]?.kind).toBe("quote");
    expect(section.blocks[2]?.kind).toBe("code");
    expect(section.blocks[3]?.kind).toBe("table");
    expect(section.blocks[4]?.kind).toBe("thematic-break");
    expect(table.rows[0]?.cells[0]?.blocks[0]?.kind).toBe("text");
  });
});
