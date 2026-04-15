import { describe, expect, it } from "vitest";
import type { Book, SectionDocument, TocItem } from "../src/model/types";
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
        <h1 id="intro">Simple</h1>
        <p>Plain reading flow.</p>
      </section>
    </body>
  </html>`;

const COMPLEX_CHAPTER = `<?xml version="1.0" encoding="utf-8"?>
  <html xmlns="http://www.w3.org/1999/xhtml">
    <head><title>Complex</title></head>
    <body>
      <section>
        <h1>Complex</h1>
        <p><a href="#details">Jump to details</a></p>
        <table>
          <tr><td>Fallback</td></tr>
        </table>
        <p id="details">Extra detail block.</p>
      </section>
    </body>
  </html>`;

function createHybridReaderFixture(): {
  reader: EpubReader;
  container: HTMLDivElement;
  book: Book;
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

  const toc: TocItem[] = [
    {
      id: "toc-simple",
      label: "Simple",
      href: "OPS/simple.xhtml#intro",
      children: []
    },
    {
      id: "toc-complex",
      label: "Complex",
      href: "OPS/complex.xhtml#details",
      children: []
    }
  ];

  const book: Book = {
    metadata: { title: "Hybrid Navigation" },
    manifest: [],
    spine: [
      { idref: "item-1", href: simpleSection.href, linear: true },
      { idref: "item-2", href: complexSection.href, linear: true }
    ],
    toc,
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
    container,
    book
  };
}

describe("EpubReader hybrid navigation", () => {
  it("keeps toc navigation stable across canvas and dom chapters", async () => {
    const { reader, container } = createHybridReaderFixture();

    await reader.render();
    expect(reader.getRenderMetrics().backend).toBe("canvas");

    await reader.goToTocItem("toc-complex");
    expect(reader.getRenderMetrics().backend).toBe("dom");
    expect(reader.getCurrentLocation()?.spineIndex).toBe(1);
    expect(reader.getCurrentLocation()?.blockId).toBeTruthy();
    expect(container.dataset.renderMode).toBe("dom");

    await reader.goToTocItem("toc-simple");
    expect(reader.getRenderMetrics().backend).toBe("canvas");
    expect(reader.getCurrentLocation()?.spineIndex).toBe(0);
    expect(reader.getCurrentLocation()?.blockId).toBeTruthy();
    expect(container.dataset.renderMode).toBe("canvas");
  });

  it("keeps same-chapter anchor links inside dom chapters on the current section", async () => {
    const { reader, container } = createHybridReaderFixture();

    await reader.goToLocation({
      spineIndex: 1,
      progressInSection: 0
    });

    expect(reader.getRenderMetrics().backend).toBe("dom");
    const domLink = container.querySelector(".epub-dom-section a");
    expect(domLink).toBeTruthy();

    domLink?.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true
      })
    );
    await Promise.resolve();

    expect(reader.getRenderMetrics().backend).toBe("dom");
    expect(reader.getCurrentLocation()?.spineIndex).toBe(1);
    expect(reader.getCurrentLocation()?.blockId).toBeTruthy();
    expect(container.dataset.renderMode).toBe("dom");
  });
});
