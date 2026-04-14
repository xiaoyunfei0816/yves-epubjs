import { describe, expect, it, vi } from "vitest";
import { InMemoryResourceContainer } from "../src/container/resource-container";
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
});
