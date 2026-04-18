import { describe, expect, it } from "vitest";
import {
  preprocessChapterDocument,
  type PreprocessedChapter
} from "../src";

describe("chapter preprocess", () => {
  it("filters whitespace-only text nodes while preserving meaningful text", () => {
    const chapter = preprocessChapterDocument({
      href: "OPS/whitespace.xhtml",
      content: `<?xml version="1.0" encoding="utf-8"?>
        <html xmlns="http://www.w3.org/1999/xhtml">
          <body>
            <div>
              
              <p>Hello</p>
              
            </div>
          </body>
        </html>`
    });

    expect(chapter.nodes).toEqual([
      {
        kind: "element",
        tagName: "div",
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
    ]);
  });

  it("normalizes common chapter structure, metadata, and attributes", () => {
    const chapter = preprocessChapterDocument({
      href: "OPS/chapter-1.xhtml",
      content: `<?xml version="1.0" encoding="utf-8"?>
        <html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" dir="rtl">
          <head>
            <title>Chapter 1</title>
          </head>
          <body>
            <section id="ch1" class="chapter lead">
              <p style="font-size: 18px;">
                Hello <a href="#note-1">note</a>
              </p>
            </section>
          </body>
        </html>`
    });

    expect(chapter).toEqual({
      href: "OPS/chapter-1.xhtml",
      title: "Chapter 1",
      lang: "en",
      dir: "rtl",
      rootTagName: "body",
      nodes: [
        {
          kind: "element",
          tagName: "section",
          attributes: {
            id: "ch1",
            class: "chapter lead"
          },
          children: [
            {
              kind: "element",
              tagName: "p",
              attributes: {
                style: "font-size: 18px;"
              },
              children: [
                { kind: "text", text: "\n                Hello " },
                {
                  kind: "element",
                  tagName: "a",
                  attributes: {
                    href: "#note-1"
                  },
                  children: [{ kind: "text", text: "note" }]
                }
              ]
            }
          ]
        }
      ]
    } satisfies PreprocessedChapter);
  });
});
