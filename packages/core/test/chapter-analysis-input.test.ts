import { describe, expect, it } from "vitest";
import {
  buildChapterAnalysisInput,
  parseXhtmlDomDocument,
  type ChapterAnalysisInput
} from "../src";

function analyzeChapter(href: string, xml: string): ChapterAnalysisInput {
  return buildChapterAnalysisInput({
    href,
    document: parseXhtmlDomDocument(xml)
  });
}

describe("chapter analysis input", () => {
  it("builds stable metrics for an empty chapter", () => {
    const analysis = analyzeChapter(
      "OPS/empty.xhtml",
      `<?xml version="1.0" encoding="utf-8"?>
      <html xmlns="http://www.w3.org/1999/xhtml">
        <body></body>
      </html>`
    );

    expect(analysis).toEqual({
      href: "OPS/empty.xhtml",
      rootTagName: "body",
      nodeCount: 0,
      elementCount: 0,
      textNodeCount: 0,
      maxDepth: 0,
      tagCounts: {},
      styledElementCount: 0,
      inlineStyleDeclarationCount: 0,
      stylePropertyCounts: {},
      classTokenCount: 0,
      idAttributeCount: 0
    } satisfies ChapterAnalysisInput);
  });

  it("collects tag counts, inline style data, and shallow nesting metrics for a normal chapter", () => {
    const analysis = analyzeChapter(
      "OPS/normal.xhtml",
      `<?xml version="1.0" encoding="utf-8"?>
      <html xmlns="http://www.w3.org/1999/xhtml">
        <body>
          <section>
            <h1>Title</h1>
            <p class="lead" style="font-size: 18px; color: #333;">Hello <strong>world</strong></p>
            <img src="cover.jpg" alt="Cover" />
          </section>
        </body>
      </html>`
    );

    expect(analysis.href).toBe("OPS/normal.xhtml");
    expect(analysis.rootTagName).toBe("body");
    expect(analysis.nodeCount).toBe(8);
    expect(analysis.elementCount).toBe(5);
    expect(analysis.textNodeCount).toBe(3);
    expect(analysis.maxDepth).toBe(4);
    expect(analysis.tagCounts).toEqual({
      section: 1,
      h1: 1,
      p: 1,
      strong: 1,
      img: 1
    });
    expect(analysis.styledElementCount).toBe(1);
    expect(analysis.inlineStyleDeclarationCount).toBe(2);
    expect(analysis.stylePropertyCounts).toEqual({
      "font-size": 1,
      color: 1
    });
    expect(analysis.classTokenCount).toBe(1);
    expect(analysis.idAttributeCount).toBe(0);
  });

  it("captures deep nesting, ids, and complex style properties for a complex chapter", () => {
    const analysis = analyzeChapter(
      "OPS/complex.xhtml",
      `<?xml version="1.0" encoding="utf-8"?>
      <html xmlns="http://www.w3.org/1999/xhtml">
        <body>
          <div id="shell">
            <section>
              <article>
                <aside style="display: flex; position: absolute;">
                  <p>Note</p>
                </aside>
                <table>
                  <tr>
                    <td>Cell</td>
                  </tr>
                </table>
              </article>
            </section>
          </div>
        </body>
      </html>`
    );

    expect(analysis.nodeCount).toBe(10);
    expect(analysis.elementCount).toBe(8);
    expect(analysis.textNodeCount).toBe(2);
    expect(analysis.maxDepth).toBe(7);
    expect(analysis.tagCounts).toEqual({
      div: 1,
      section: 1,
      article: 1,
      aside: 1,
      p: 1,
      table: 1,
      tr: 1,
      td: 1
    });
    expect(analysis.styledElementCount).toBe(1);
    expect(analysis.inlineStyleDeclarationCount).toBe(2);
    expect(analysis.stylePropertyCounts).toEqual({
      display: 1,
      position: 1
    });
    expect(analysis.classTokenCount).toBe(0);
    expect(analysis.idAttributeCount).toBe(1);
  });
});
