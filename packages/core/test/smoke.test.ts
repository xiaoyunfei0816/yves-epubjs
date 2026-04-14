// @vitest-environment node

import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { EpubReader, InMemoryResourceContainer, ZipResourceContainer } from "../src";

describe("core scaffold", () => {
  const encoder = new TextEncoder();

  function createMinimalEpubBytes(): Uint8Array {
    return zipSync({
      mimetype: encoder.encode("application/epub+zip"),
      "META-INF/container.xml": encoder.encode(
        `<?xml version="1.0"?>
        <container>
          <rootfiles>
            <rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml" />
          </rootfiles>
        </container>`
      ),
      "OPS/content.opf": encoder.encode(
        `<?xml version="1.0"?>
        <package>
          <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
            <dc:title>Smoke Test Book</dc:title>
          </metadata>
          <manifest>
            <item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml" />
          </manifest>
          <spine>
            <itemref idref="chapter-1" />
          </spine>
        </package>`
      ),
      "OPS/chapter-1.xhtml": encoder.encode(
        `<?xml version="1.0"?>
        <html>
          <head><title>Smoke Test Book</title></head>
          <body><h1>Smoke Test Book</h1><p>Sample paragraph.</p></body>
        </html>`
      )
    });
  }

  it("creates a reader instance", () => {
    const reader = new EpubReader();
    expect(reader.getCurrentLocation()).toBeNull();
  });

  it("opens a Uint8Array input", async () => {
    const reader = new EpubReader();
    const book = await reader.open(createMinimalEpubBytes());

    expect(book.metadata.title).toBe("Smoke Test Book");
  });

  it("resolves resource paths", () => {
    const container = new InMemoryResourceContainer();
    expect(container.resolvePath("OPS/chapter-1.xhtml", "../images/a.png")).toBe(
      "images/a.png"
    );
  });

  it("creates a ZIP-backed resource container", async () => {
    const container = await ZipResourceContainer.fromZip(
      new Uint8Array([
        80, 75, 5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
      ])
    );

    expect(container.listPaths()).toEqual([]);
  });

  it("keeps the smoke suite focused on parser/runtime basics", () => {
    expect(true).toBe(true);
  });
});
