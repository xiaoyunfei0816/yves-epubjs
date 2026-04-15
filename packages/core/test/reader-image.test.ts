import { describe, expect, it, vi } from "vitest";
import { InMemoryResourceContainer } from "../src/container/resource-container";
import type { Book, SectionDocument } from "../src/model/types";
import { EpubReader } from "../src/runtime/reader";

describe("EpubReader image resources", () => {
  it("converts EPUB image resources into object URLs for rendering", async () => {
    const createObjectURL = vi.fn(() => "blob:cover-image");
    const revokeObjectURL = vi.fn();
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;

    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    const container = document.createElement("div");
    const reader = new EpubReader({ container });

    const resources = new InMemoryResourceContainer({
      "OPS/images/cover.png": new Uint8Array([137, 80, 78, 71])
    });

    const imageUrl = (reader as unknown as {
      resources: typeof resources;
      resolveRenderableResourceUrl(path: string): string;
    });

    imageUrl.resources = resources;
    expect(imageUrl.resolveRenderableResourceUrl("OPS/images/cover.png")).toBe(
      "OPS/images/cover.png"
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(imageUrl.resolveRenderableResourceUrl("OPS/images/cover.png")).toBe(
      "blob:cover-image"
    );

    reader.destroy();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:cover-image");

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("uses resolved blob URLs for canvas image rendering and hit testing", async () => {
    const createObjectURL = vi.fn(() => "blob:cover-image");
    const revokeObjectURL = vi.fn();
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;

    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 320
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 320
    });

    const reader = new EpubReader({
      container,
      mode: "paginated"
    });

    const section: SectionDocument = {
      id: "section-image",
      href: "OPS/image.xhtml",
      title: "Images",
      anchors: {},
      blocks: [
        {
          id: "image-1",
          kind: "image",
          src: "OPS/images/cover.png",
          alt: "Cover",
          width: 320,
          height: 240
        }
      ]
    };

    const book: Book = {
      metadata: { title: "Images" },
      manifest: [],
      spine: [
        {
          idref: "item-1",
          href: section.href,
          linear: true
        }
      ],
      toc: [],
      sections: [section]
    };

    const resources = new InMemoryResourceContainer({
      "OPS/images/cover.png": new Uint8Array([137, 80, 78, 71])
    });

    (reader as unknown as { book: Book; resources: typeof resources }).book = book;
    (reader as unknown as { book: Book; resources: typeof resources }).resources = resources;
    await reader.render();
    await Promise.resolve();
    await Promise.resolve();

    const hit = reader.hitTest({
      x: 160,
      y: 120
    });

    expect(hit?.kind).toBe("image");
    expect(hit && hit.kind === "image" ? hit.src : null).toBe("blob:cover-image");

    reader.destroy();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });
});
