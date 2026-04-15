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
        <h1>Simple</h1>
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
        <p><a href="OPS/simple.xhtml">Back to simple</a></p>
        <table>
          <tr><td>Fallback</td></tr>
        </table>
      </section>
    </body>
  </html>`;

describe("EpubReader chapter render routing", () => {
  it("routes different chapters to canvas and dom rendering paths", async () => {
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
      metadata: { title: "Hybrid Reader" },
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

    await reader.render();

    expect(reader.getRenderMetrics().backend).toBe("canvas");
    expect(reader.getRenderDiagnostics()).toEqual({
      mode: "canvas",
      score: 0,
      reasons: [],
      sectionId: "section-1",
      sectionHref: "OPS/simple.xhtml"
    });
    expect(reader.getVisibleSectionDiagnostics()).toEqual([
      {
        mode: "canvas",
        score: 0,
        reasons: [],
        sectionId: "section-1",
        sectionHref: "OPS/simple.xhtml",
        isCurrent: true
      },
      {
        mode: "dom",
        score: 20,
        reasons: ["high-risk-tag:table"],
        sectionId: "section-2",
        sectionHref: "OPS/complex.xhtml",
        isCurrent: false
      }
    ]);
    expect(container.querySelector("canvas.epub-canvas-section")).toBeTruthy();
    expect(container.querySelector("article.epub-section-dom .epub-dom-section")).toBeTruthy();
    expect(container.dataset.renderMode).toBe("canvas");

    await reader.goToLocation({
      spineIndex: 1,
      progressInSection: 0
    });

    expect(reader.getRenderMetrics().backend).toBe("dom");
    expect(reader.getRenderDiagnostics()).toEqual({
      mode: "dom",
      score: 20,
      reasons: ["high-risk-tag:table"],
      sectionId: "section-2",
      sectionHref: "OPS/complex.xhtml"
    });
    expect(reader.getVisibleSectionDiagnostics()).toEqual([
      {
        mode: "canvas",
        score: 0,
        reasons: [],
        sectionId: "section-1",
        sectionHref: "OPS/simple.xhtml",
        isCurrent: false
      },
      {
        mode: "dom",
        score: 20,
        reasons: ["high-risk-tag:table"],
        sectionId: "section-2",
        sectionHref: "OPS/complex.xhtml",
        isCurrent: true
      }
    ]);
    expect(container.querySelector(".epub-dom-section")).toBeTruthy();
    expect(container.querySelector("article.epub-section-canvas canvas.epub-canvas-section")).toBeTruthy();
    expect(container.dataset.renderMode).toBe("dom");

    const domLink = container.querySelector(".epub-dom-section a");
    expect(domLink).toBeTruthy();
    domLink?.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true
      })
    );
    await Promise.resolve();

    expect(reader.getRenderMetrics().backend).toBe("canvas");
    expect(container.dataset.renderMode).toBe("canvas");

    await reader.goToLocation({
      spineIndex: 1,
      progressInSection: 0
    });

    const domSection = container.querySelector(".epub-dom-section") as HTMLElement | null;
    expect(domSection).toBeTruthy();
    Object.defineProperty(domSection!, "scrollHeight", {
      configurable: true,
      value: 400
    });
    domSection!.getBoundingClientRect = () =>
      ({
        top: 20,
        left: 0,
        right: 320,
        bottom: 420,
        width: 320,
        height: 400,
        x: 0,
        y: 20,
        toJSON() {
          return {};
        }
      }) as DOMRect;

    domSection!.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        clientX: 40,
        clientY: 220
      })
    );

    const relocated = reader.getCurrentLocation();
    expect(relocated?.spineIndex).toBe(1);
    expect(relocated?.progressInSection ?? 0).toBeGreaterThan(0.45);
    expect(relocated?.progressInSection ?? 0).toBeLessThan(0.55);

    const originalGetSelection = window.getSelection;
    Object.defineProperty(window, "getSelection", {
      configurable: true,
      value: () => ({
        toString: () => "selected text"
      })
    });

    domSection!.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        clientX: 40,
        clientY: 380
      })
    );

    expect(reader.getCurrentLocation()?.progressInSection).toBe(relocated?.progressInSection);

    Object.defineProperty(window, "getSelection", {
      configurable: true,
      value: originalGetSelection
    });

    await reader.goToLocation({
      spineIndex: 0,
      progressInSection: 0
    });

    expect(reader.getRenderMetrics().backend).toBe("canvas");
    expect(container.querySelector("canvas.epub-canvas-section")).toBeTruthy();
    expect(container.querySelector(".epub-dom-section")).toBeTruthy();
  });
});
