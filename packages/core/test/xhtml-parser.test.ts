import { describe, expect, it } from "vitest";
import { parseXhtmlDocument } from "../src/parser/xhtml-parser";

function stripIds(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripIds);
  }

  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "id") {
        continue;
      }
      next[key] = stripIds(child);
    }

    return next;
  }

  return value;
}

describe("parseXhtmlDocument", () => {
  it("maps headings, paragraphs, lists, quotes, code blocks, images, and thematic breaks", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
        <head><title>Chapter 1</title></head>
        <body>
          <h1 id="intro">Chapter 1</h1>
          <p>Alice was beginning to get very tired.</p>
          <blockquote>
            <p>What is the use of a book?</p>
          </blockquote>
          <pre><code data-language="js">console.log('alice')</code></pre>
          <img src="../images/cover.png" alt="Cover" width="320" height="480" />
          <hr />
          <ul>
            <li>First item</li>
            <li><p>Second item</p></li>
          </ul>
        </body>
      </html>`;

    const section = parseXhtmlDocument(xml, "OPS/text/chapter-1.xhtml");

    expect(section.title).toBe("Chapter 1");
    expect(section.lang).toBe("en");
    expect(section.anchors.intro).toBe("heading-1");
    expect(section.blocks.map((block) => block.kind)).toEqual([
      "heading",
      "text",
      "quote",
      "code",
      "image",
      "thematic-break",
      "list"
    ]);

    const imageBlock = section.blocks[4];
    expect(imageBlock).toMatchObject({
      kind: "image",
      src: "OPS/images/cover.png",
      alt: "Cover",
      width: 320,
      height: 480
    });
  });

  it("parses ordered lists and tables into structured blocks", () => {
    const xml = `<?xml version="1.0"?>
      <html>
        <body>
          <ol start="3">
            <li>Third</li>
            <li>Fourth</li>
          </ol>
          <table>
            <tr>
              <th>Name</th>
              <td colspan="2">Alice</td>
            </tr>
          </table>
        </body>
      </html>`;

    const section = parseXhtmlDocument(xml, "OPS/chapter.xhtml");

    expect(section.blocks[0]).toMatchObject({
      kind: "list",
      ordered: true,
      start: 3
    });
    expect(section.blocks[1]).toMatchObject({
      kind: "table"
    });
    expect(stripIds(section)).toEqual({
      href: "OPS/chapter.xhtml",
      blocks: [
        {
          kind: "list",
          ordered: true,
          start: 3,
          items: [
            {
              blocks: [
                {
                  kind: "text",
                  inlines: [{ kind: "text", text: "Third" }]
                }
              ]
            },
            {
              blocks: [
                {
                  kind: "text",
                  inlines: [{ kind: "text", text: "Fourth" }]
                }
              ]
            }
          ]
        },
        {
          kind: "table",
          rows: [
            {
              cells: [
                {
                  blocks: [
                    {
                      kind: "text",
                      inlines: [{ kind: "text", text: "Name" }]
                    }
                  ],
                  header: true
                },
                {
                  blocks: [
                    {
                      kind: "text",
                      inlines: [{ kind: "text", text: "Alice" }]
                    }
                  ],
                  colSpan: 2
                }
              ]
            }
          ]
        }
      ],
      anchors: {}
    });
  });

  it("flattens structural wrapper elements and ignores unsupported tags", () => {
    const xml = `<?xml version="1.0"?>
      <html>
        <body>
          <section id="chapter-2">
            <div>
              <h2><a id="heading-anchor"></a>Wrapped heading</h2>
              <aside>Ignored aside</aside>
              <p>Wrapped paragraph</p>
            </div>
          </section>
        </body>
      </html>`;

    const section = parseXhtmlDocument(xml, "OPS/wrapped.xhtml");

    expect(section.blocks).toHaveLength(2);
    expect(section.blocks[0]).toMatchObject({ kind: "heading", level: 2 });
    expect(section.blocks[1]).toMatchObject({ kind: "text" });
    expect(section.anchors["chapter-2"]).toBe("heading-1");
    expect(section.anchors["heading-anchor"]).toBe("heading-1");
  });

  it("binds standalone anchor markers to the next rendered block", () => {
    const xml = `<?xml version="1.0"?>
      <html>
        <body>
          <a id="chapter-4"></a>
          <a name="chapter-4-name"></a>
          <span id="chapter-4-span"></span>
          <h2>Chapter 4</h2>
          <p>Later paragraph</p>
        </body>
      </html>`;

    const section = parseXhtmlDocument(xml, "OPS/combined.xhtml");

    expect(section.blocks).toHaveLength(2);
    expect(section.blocks[0]).toMatchObject({ kind: "heading", level: 2 });
    expect(section.anchors["chapter-4"]).toBe("heading-1");
    expect(section.anchors["chapter-4-name"]).toBe("heading-1");
    expect(section.anchors["chapter-4-span"]).toBe("heading-1");
  });
});
