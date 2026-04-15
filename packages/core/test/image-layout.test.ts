import { describe, expect, it } from "vitest";
import { LayoutEngine } from "../src/layout/layout-engine";
import type { ImageDrawOp } from "../src/renderer/draw-ops";
import { DisplayListBuilder } from "../src/renderer/display-list-builder";
import { resolveImageLayout } from "../src/utils/image-layout";
import type { SectionDocument } from "../src/model/types";

const typography = {
  fontSize: 18,
  lineHeight: 1.6,
  paragraphSpacing: 12
} as const;

const theme = {
  color: "#1f2328",
  background: "#fffdf7"
} as const;

describe("image layout strategy", () => {
  it("keeps small images at their intrinsic width instead of stretching to fill the column", () => {
    const layout = resolveImageLayout({
      availableWidth: 480,
      viewportHeight: 720,
      intrinsicWidth: 120,
      intrinsicHeight: 90
    });

    expect(layout.width).toBe(120);
    expect(layout.height).toBe(90);
  });

  it("allows wide images to use a larger width budget than regular illustrations", () => {
    const wide = resolveImageLayout({
      availableWidth: 480,
      viewportHeight: 720,
      intrinsicWidth: 1600,
      intrinsicHeight: 900
    });
    const regular = resolveImageLayout({
      availableWidth: 480,
      viewportHeight: 720,
      intrinsicWidth: 1000,
      intrinsicHeight: 1000
    });

    expect(wide.width).toBeGreaterThan(regular.width);
  });

  it("caps tall portrait images against the viewport height", () => {
    const layout = resolveImageLayout({
      availableWidth: 480,
      viewportHeight: 400,
      intrinsicWidth: 600,
      intrinsicHeight: 1800
    });

    expect(layout.height).toBeLessThanOrEqual(400 * 0.78);
    expect(layout.width).toBeLessThan(480 * 0.9);
  });

  it("uses the same geometry for block height estimation and canvas image rects", () => {
    const section: SectionDocument = {
      id: "section-image",
      href: "OPS/image.xhtml",
      anchors: {},
      blocks: [
        {
          id: "image-1",
          kind: "image",
          src: "OPS/image.jpg",
          alt: "Inline image",
          width: 120,
          height: 90
        }
      ]
    };

    const engine = new LayoutEngine();
    const layout = engine.layout(
      {
        section,
        spineIndex: 0,
        viewportWidth: 400,
        viewportHeight: 600,
        typography,
        fontFamily: "serif"
      },
      "scroll"
    );
    const builder = new DisplayListBuilder();
    const displayList = builder.buildSection({
      section,
      width: 400,
      viewportHeight: 600,
      blocks: layout.blocks,
      theme,
      typography,
      activeBlockId: undefined
    });
    const imageOp = displayList.ops.find((op): op is ImageDrawOp => op.kind === "image");

    expect(layout.blocks[0]?.estimatedHeight).toBe(106);
    expect(imageOp).toBeTruthy();
    expect(imageOp?.rect).toEqual({
      x: 140,
      y: 8,
      width: 120,
      height: 90
    });
    expect(displayList.height).toBe(106);
  });
});
