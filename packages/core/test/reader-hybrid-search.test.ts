import { describe, expect, it } from "vitest";
import type { Book, SectionDocument } from "../src/model/types";
import {
  EpubReader,
  createSharedChapterRenderInput,
  toCanvasChapterRenderInput
} from "../src";

const SIMPLE_CHAPTER = `<?xml version="1.0" encoding="utf-8"?>
  <html xmlns="http://www.w3.org/1999/xhtml">
    <head><title>Simple</title></head>
    <body>
      <section>
        <h1>Simple chapter</h1>
        <p>Canvas search target.</p>
      </section>
    </body>
  </html>`;

const COMPLEX_CHAPTER = `<?xml version="1.0" encoding="utf-8"?>
  <html xmlns="http://www.w3.org/1999/xhtml">
    <head><title>Complex</title></head>
    <body>
      <section>
        <h1>Complex chapter</h1>
        <table>
          <tr><td>DOM search target.</td></tr>
        </table>
      </section>
    </body>
  </html>`;

function createHybridSearchFixture(): {
  reader: EpubReader;
  container: HTMLDivElement;
} {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", {
    configurable: true,
    value: 320
  });
  Object.defineProperty(container, "clientHeight", {
    configurable: true,
    value: 480
  });
  document.body.appendChild(container);

  const simpleInput = createSharedChapterRenderInput({
    href: "OPS/simple.xhtml",
    content: SIMPLE_CHAPTER
  });
  const complexInput = createSharedChapterRenderInput({
    href: "OPS/complex.xhtml",
    content: COMPLEX_CHAPTER
  });
  const simpleSection: SectionDocument = {
    ...toCanvasChapterRenderInput(simpleInput).section,
    id: "section-1"
  };
  const complexSection: SectionDocument = {
    ...toCanvasChapterRenderInput(complexInput).section,
    id: "section-2"
  };

  const book: Book = {
    metadata: { title: "Hybrid Search" },
    manifest: [],
    spine: [
      { idref: "item-1", href: simpleSection.href, linear: true },
      { idref: "item-2", href: complexSection.href, linear: true }
    ],
    toc: [],
    sections: [simpleSection, complexSection]
  };

  const reader = new EpubReader({ container, mode: "scroll" });
  (
    reader as unknown as {
      book: Book;
      chapterRenderInputs: ReturnType<typeof createSharedChapterRenderInput>[];
    }
  ).book = book;
  (
    reader as unknown as {
      book: Book;
      chapterRenderInputs: ReturnType<typeof createSharedChapterRenderInput>[];
    }
  ).chapterRenderInputs = [simpleInput, complexInput];

  return {
    reader,
    container
  };
}

describe("EpubReader hybrid search", () => {
  it("navigates search results into canvas and dom chapters through a unified adapter", async () => {
    const { reader, container } = createHybridSearchFixture();

    const canvasResults = await reader.search("Canvas search target");
    const domResults = await reader.search("DOM search target");

    expect(canvasResults).toHaveLength(1);
    expect(domResults).toHaveLength(1);

    await reader.goToSearchResult(domResults[0]!);
    expect(reader.getRenderMetrics().backend).toBe("dom");
    expect(reader.getCurrentLocation()?.spineIndex).toBe(1);
    expect(container.dataset.renderMode).toBe("dom");

    await reader.goToSearchResult(canvasResults[0]!);
    expect(reader.getRenderMetrics().backend).toBe("canvas");
    expect(reader.getCurrentLocation()?.spineIndex).toBe(0);
    expect(container.dataset.renderMode).toBe("canvas");
  });
});
