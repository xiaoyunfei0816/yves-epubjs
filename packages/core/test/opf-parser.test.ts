// @vitest-environment node

import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { BookParser } from "../src/parser/book-parser";
import { parseOpfDocument } from "../src/parser/opf-parser";

describe("parseOpfDocument", () => {
  it("parses metadata, manifest, and spine from a standard OPF document", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <package version="3.0" unique-identifier="BookId">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:title>Alice in Wonderland</dc:title>
          <dc:language>en</dc:language>
          <dc:identifier>urn:uuid:alice</dc:identifier>
          <dc:creator>Lewis Carroll</dc:creator>
          <dc:publisher>Macmillan</dc:publisher>
        </metadata>
        <manifest>
          <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
          <item id="chapter-1" href="text/chapter-1.xhtml" media-type="application/xhtml+xml" />
          <item id="cover" href="../images/cover.jpg" media-type="image/jpeg" />
        </manifest>
        <spine>
          <itemref idref="chapter-1" />
          <itemref idref="nav" linear="no" properties="auxiliary" />
        </spine>
      </package>`;

    const result = parseOpfDocument(xml, "OPS/content.opf");

    expect(result.metadata).toEqual({
      title: "Alice in Wonderland",
      language: "en",
      identifier: "urn:uuid:alice",
      creator: "Lewis Carroll",
      publisher: "Macmillan"
    });
    expect(result.manifest).toEqual([
      {
        id: "nav",
        href: "OPS/nav.xhtml",
        mediaType: "application/xhtml+xml",
        properties: "nav"
      },
      {
        id: "chapter-1",
        href: "OPS/text/chapter-1.xhtml",
        mediaType: "application/xhtml+xml"
      },
      {
        id: "cover",
        href: "images/cover.jpg",
        mediaType: "image/jpeg"
      }
    ]);
    expect(result.spine).toEqual([
      {
        idref: "chapter-1",
        href: "OPS/text/chapter-1.xhtml",
        linear: true,
        mediaType: "application/xhtml+xml"
      },
      {
        idref: "nav",
        href: "OPS/nav.xhtml",
        linear: false,
        mediaType: "application/xhtml+xml",
        properties: "auxiliary"
      }
    ]);
  });

  it("skips incomplete manifest and unresolved spine entries", () => {
    const xml = `<?xml version="1.0"?>
      <package>
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:title>Untitled</dc:title>
        </metadata>
        <manifest>
          <item id="valid" href="chapter.xhtml" media-type="application/xhtml+xml" />
          <item id="missing-href" media-type="application/xhtml+xml" />
        </manifest>
        <spine>
          <itemref idref="valid" />
          <itemref idref="missing" />
        </spine>
      </package>`;

    const result = parseOpfDocument(xml, "OPS/content.opf");

    expect(result.manifest).toHaveLength(1);
    expect(result.spine).toEqual([
      {
        idref: "valid",
        href: "OPS/chapter.xhtml",
        linear: true,
        mediaType: "application/xhtml+xml"
      }
    ]);
  });
});

describe("BookParser", () => {
  it("builds a minimal Book model from container.xml, OPF, and NAV", async () => {
    const zipBytes = zipSync({
      mimetype: Buffer.from("application/epub+zip"),
      "META-INF/container.xml": Buffer.from(
        `<?xml version="1.0"?>
        <container>
          <rootfiles>
            <rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml" />
          </rootfiles>
        </container>`
      ),
      "OPS/content.opf": Buffer.from(
        `<?xml version="1.0"?>
        <package>
          <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
            <dc:title>Fixture Book</dc:title>
            <dc:language>en</dc:language>
          </metadata>
          <manifest>
            <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
            <item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml" />
          </manifest>
          <spine>
            <itemref idref="chapter-1" />
          </spine>
        </package>`
      ),
      "OPS/nav.xhtml": Buffer.from(
        `<?xml version="1.0"?>
        <html xmlns:epub="http://www.idpf.org/2007/ops">
          <body>
            <nav epub:type="toc">
              <ol>
                <li><a href="chapter-1.xhtml">Chapter 1</a></li>
              </ol>
            </nav>
          </body>
        </html>`
      ),
      "OPS/chapter-1.xhtml": Buffer.from(
        `<?xml version="1.0"?>
        <html>
          <head><title>Chapter 1</title></head>
          <body><h1>Chapter 1</h1><p>Hello Alice</p></body>
        </html>`
      )
    });

    const book = await new BookParser().parse({ data: zipBytes });

    expect(book).toEqual({
      metadata: {
        title: "Fixture Book",
        language: "en"
      },
      manifest: [
        {
          id: "nav",
          href: "OPS/nav.xhtml",
          mediaType: "application/xhtml+xml",
          properties: "nav"
        },
        {
          id: "chapter-1",
          href: "OPS/chapter-1.xhtml",
          mediaType: "application/xhtml+xml"
        }
      ],
      spine: [
        {
          idref: "chapter-1",
          href: "OPS/chapter-1.xhtml",
          linear: true,
          mediaType: "application/xhtml+xml"
        }
      ],
      toc: [
        {
          id: "toc.0:Chapter 1",
          label: "Chapter 1",
          href: "OPS/chapter-1.xhtml",
          children: []
        }
      ],
      sections: [
        {
          id: "section-1",
          href: "OPS/chapter-1.xhtml",
          title: "Chapter 1",
          blocks: [
            {
              id: "heading-1",
              kind: "heading",
              tagName: "h1",
              level: 1,
              inlines: [{ kind: "text", text: "Chapter 1" }]
            },
            {
              id: "text-2",
              kind: "text",
              tagName: "p",
              inlines: [{ kind: "text", text: "Hello Alice" }]
            }
          ],
          anchors: {}
        }
      ]
    });
  });

  it("falls back to NCX when NAV is missing", async () => {
    const zipBytes = zipSync({
      mimetype: Buffer.from("application/epub+zip"),
      "META-INF/container.xml": Buffer.from(
        `<?xml version="1.0"?>
        <container>
          <rootfiles>
            <rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml" />
          </rootfiles>
        </container>`
      ),
      "OPS/content.opf": Buffer.from(
        `<?xml version="1.0"?>
        <package>
          <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
            <dc:title>NCX Fixture Book</dc:title>
          </metadata>
          <manifest>
            <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
            <item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml" />
          </manifest>
          <spine toc="ncx">
            <itemref idref="chapter-1" />
          </spine>
        </package>`
      ),
      "OPS/toc.ncx": Buffer.from(
        `<?xml version="1.0"?>
        <ncx xmlns="http://www.daisy.org/z3986/2005/ncx/">
          <navMap>
            <navPoint id="chapter-1">
              <navLabel><text>Chapter 1</text></navLabel>
              <content src="chapter-1.xhtml" />
            </navPoint>
          </navMap>
        </ncx>`
      ),
      "OPS/chapter-1.xhtml": Buffer.from(
        `<?xml version="1.0"?>
        <html>
          <head><title>Chapter 1</title></head>
          <body><h1>Chapter 1</h1><p>NCX chapter</p></body>
        </html>`
      )
    });

    const book = await new BookParser().parse({ data: zipBytes });

    expect(book.toc).toEqual([
      {
        id: "chapter-1",
        label: "Chapter 1",
        href: "OPS/chapter-1.xhtml",
        children: []
      }
    ]);
  });

  it("rejects non-XHTML spine documents before chapter parsing", async () => {
    const zipBytes = zipSync({
      mimetype: Buffer.from("application/epub+zip"),
      "META-INF/container.xml": Buffer.from(
        `<?xml version="1.0"?>
        <container>
          <rootfiles>
            <rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml" />
          </rootfiles>
        </container>`
      ),
      "OPS/content.opf": Buffer.from(
        `<?xml version="1.0"?>
        <package>
          <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
            <dc:title>Invalid Spine Book</dc:title>
          </metadata>
          <manifest>
            <item id="style" href="styles.css" media-type="text/css" />
          </manifest>
          <spine>
            <itemref idref="style" />
          </spine>
        </package>`
      ),
      "OPS/styles.css": Buffer.from("body { color: red; }")
    })

    await expect(new BookParser().parse({ data: zipBytes })).rejects.toThrow(
      "Unsupported spine content media type: text/css (OPS/styles.css)"
    )
  })
});
