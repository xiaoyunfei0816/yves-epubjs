import type {
  BlockNode,
  Locator,
  SectionDocument,
  Theme,
  TypographyOptions
} from "../model/types";
import type { LayoutBlock, LayoutPretextBlock } from "../layout/layout-engine";
import type {
  DrawOp,
  ImageDrawOp,
  InteractionRegion,
  LineDrawOp,
  RectDrawOp,
  SectionDisplayList,
  TextRunDrawOp
} from "./draw-ops";
import { resolveImageLayout } from "../utils/image-layout";

type BuilderOptions = {
  section: SectionDocument;
  width: number;
  viewportHeight: number;
  blocks: LayoutBlock[];
  theme: Theme;
  typography: TypographyOptions;
  locatorMap?: Map<string, Locator>;
  resolveImageLoaded?: (src: string) => boolean;
  resolveImageUrl?: (src: string) => string;
  highlightedBlockIds?: Set<string>;
  activeBlockId: string | undefined;
};

const SIDE_PADDING = 8;

export class DisplayListBuilder {
  buildSection(options: BuilderOptions): SectionDisplayList {
    let currentTop = 0;
    const ops: DrawOp[] = [];
    const interactions: InteractionRegion[] = [];
    const contentWidth = Math.max(120, options.width);

    if (options.section.title) {
      const titleTop = currentTop;
      const titleFontSize = Math.max(
        options.typography.fontSize * 1.5,
        options.typography.fontSize + 10
      );
      const titleRect = {
        x: SIDE_PADDING,
        y: titleTop,
        width: contentWidth - SIDE_PADDING * 2,
        height: titleFontSize * 1.3
      };
      ops.push({
        kind: "text",
        sectionId: options.section.id,
        sectionHref: options.section.href,
        blockId: `${options.section.id}::title`,
        locator: {
          spineIndex: options.locatorMap?.values().next().value?.spineIndex ?? 0,
          progressInSection: 0
        },
        rect: titleRect,
        text: options.section.title,
        x: titleRect.x,
        y: titleTop,
        width: titleRect.width,
        font: `700 ${titleFontSize}px "Iowan Old Style", "Palatino Linotype", serif`,
        color: options.theme.color,
        highlightColor: undefined,
        underline: undefined,
        href: undefined
      } satisfies TextRunDrawOp);
      currentTop += titleRect.height + options.typography.fontSize * 0.8;
    }

    for (const block of options.blocks) {
      const built = block.type === "pretext"
        ? this.buildPretextBlock({
            block,
            section: options.section,
            top: currentTop,
            width: contentWidth,
            theme: options.theme,
            locator: options.locatorMap?.get(block.id),
            highlighted: options.highlightedBlockIds?.has(block.id) ?? false,
            active: options.activeBlockId === block.id
          })
        : this.buildNativeBlock({
            block: block.block,
            estimatedHeight: block.estimatedHeight,
            section: options.section,
            top: currentTop,
            width: contentWidth,
            viewportHeight: options.viewportHeight,
            theme: options.theme,
            typography: options.typography,
            locator: options.locatorMap?.get(block.id),
            resolveImageLoaded: options.resolveImageLoaded,
            resolveImageUrl: options.resolveImageUrl,
            highlighted: options.highlightedBlockIds?.has(block.id) ?? false,
            active: options.activeBlockId === block.id
          });

      ops.push(...built.ops);
      interactions.push(...built.interactions);
      currentTop += built.height;
    }

    return {
      sectionId: options.section.id,
      sectionHref: options.section.href,
      width: contentWidth,
      height: Math.max(currentTop, options.typography.fontSize * 2),
      ops,
      interactions
    };
  }

  private buildPretextBlock(input: {
    block: LayoutPretextBlock;
    section: SectionDocument;
    top: number;
    width: number;
    theme: Theme;
    locator: Locator | undefined;
    highlighted: boolean;
    active: boolean;
  }): {
    ops: DrawOp[];
    interactions: InteractionRegion[];
    height: number;
  } {
    const ops: DrawOp[] = [];
    const interactions: InteractionRegion[] = [];
    const blockRect = {
      x: SIDE_PADDING,
      y: input.top,
      width: input.width - SIDE_PADDING * 2,
      height: input.block.estimatedHeight
    };
    if (input.highlighted || input.active) {
      ops.push({
        kind: "rect",
        sectionId: input.section.id,
        sectionHref: input.section.href,
        blockId: input.block.id,
        locator: input.locator,
        rect: {
          x: blockRect.x - 4,
          y: blockRect.y,
          width: blockRect.width + 8,
          height: blockRect.height
        },
        color: input.active
          ? "rgba(245, 158, 11, 0.16)"
          : "rgba(245, 158, 11, 0.08)",
        radius: 10
      } satisfies RectDrawOp);
    }
    interactions.push({
      kind: "block",
      rect: blockRect,
      sectionId: input.section.id,
      blockId: input.block.id,
      locator: input.locator,
      text: this.collectPretextText(input.block)
    });

    input.block.lines.forEach((line, lineIndex) => {
      const lineWidth = Math.max(0, line.width);
      const startX = this.resolveLineStartX(
        input.block.textAlign,
        blockRect.x,
        blockRect.width,
        lineWidth
      );
      let cursorX = startX;
      const baselineY = input.top + lineIndex * input.block.lineHeight;

      for (const fragment of line.fragments) {
        cursorX += fragment.gapBefore;
        const fragmentWidth = approximateTextWidth(fragment.text, fragment.font);
        const rect = {
          x: cursorX,
          y: baselineY,
          width: fragmentWidth,
          height: input.block.lineHeight
        };
        ops.push({
          kind: "text",
          sectionId: input.section.id,
          sectionHref: input.section.href,
          blockId: input.block.id,
          locator: input.locator,
        rect,
        text: fragment.text,
        x: cursorX,
        y: baselineY,
        width: fragmentWidth,
        font: fragment.font,
        color: fragment.href ? "#1b4b72" : input.theme.color,
        highlightColor: input.highlighted
          ? "rgba(250, 204, 21, 0.28)"
          : input.active
              ? "rgba(245, 158, 11, 0.18)"
              : undefined,
          underline: Boolean(fragment.href),
          href: fragment.href
        } satisfies TextRunDrawOp);

        if (fragment.href) {
          interactions.push({
            kind: "link",
            rect,
            sectionId: input.section.id,
            blockId: input.block.id,
            href: fragment.href,
            locator: input.locator,
            text: fragment.text
          });
        }

        cursorX += fragmentWidth;
      }
    });

    return {
      ops,
      interactions,
      height: input.block.estimatedHeight
    };
  }

  private buildNativeBlock(input: {
    block: BlockNode;
    estimatedHeight: number;
    section: SectionDocument;
    top: number;
    width: number;
    viewportHeight: number;
    theme: Theme;
    typography: TypographyOptions;
    locator: Locator | undefined;
    resolveImageLoaded: ((src: string) => boolean) | undefined;
    resolveImageUrl: ((src: string) => string) | undefined;
    highlighted: boolean;
    active: boolean;
  }): {
    ops: DrawOp[];
    interactions: InteractionRegion[];
    height: number;
  } {
    const x = SIDE_PADDING;
    const width = input.width - SIDE_PADDING * 2;
    const rect = {
      x,
      y: input.top,
      width,
      height: input.estimatedHeight
    };
    const ops: DrawOp[] = [];
    const interactions: InteractionRegion[] = [
      {
        kind: "block",
        rect,
        sectionId: input.section.id,
        blockId: input.block.id,
        locator: input.locator,
        text: extractBlockText(input.block)
      }
    ];

    if (input.highlighted || input.active) {
      ops.push({
        kind: "rect",
        sectionId: input.section.id,
        sectionHref: input.section.href,
        blockId: input.block.id,
        locator: input.locator,
        rect: {
          x,
          y: input.top,
          width,
          height: rect.height
        },
        color: input.active
          ? "rgba(245, 158, 11, 0.14)"
          : "rgba(250, 204, 21, 0.08)",
        radius: 12
      } satisfies RectDrawOp);
    }

    switch (input.block.kind) {
      case "image": {
        const renderSrc = input.resolveImageUrl?.(input.block.src) ?? input.block.src;
        const imageLayout = resolveImageLayout({
          availableWidth: width,
          viewportHeight: input.viewportHeight,
          ...(input.block.width ? { intrinsicWidth: input.block.width } : {}),
          ...(input.block.height ? { intrinsicHeight: input.block.height } : {})
        });
        const imageRect = {
          x: x + imageLayout.xOffset,
          y: input.top + imageLayout.yOffset,
          width: imageLayout.width,
          height: imageLayout.height
        };
        ops.push({
          kind: "image",
          sectionId: input.section.id,
          sectionHref: input.section.href,
          blockId: input.block.id,
          locator: input.locator,
          rect: imageRect,
          src: renderSrc,
          alt: input.block.alt,
          loaded: Boolean(input.resolveImageLoaded?.(input.block.src)),
          background: "transparent"
        } satisfies ImageDrawOp);
        interactions.push({
          kind: "image",
          rect: imageRect,
          sectionId: input.section.id,
          blockId: input.block.id,
          src: renderSrc,
          alt: input.block.alt,
          locator: input.locator
        });
        break;
      }
      case "thematic-break":
        ops.push({
          kind: "line",
          sectionId: input.section.id,
          sectionHref: input.section.href,
          blockId: input.block.id,
          locator: input.locator,
          rect,
          color: "rgba(148, 163, 184, 0.8)",
          lineWidth: 1.5,
          x1: x,
          y1: input.top + rect.height * 0.5,
          x2: x + width,
          y2: input.top + rect.height * 0.5
        } satisfies LineDrawOp);
        break;
      case "quote":
        ops.push({
          kind: "rect",
          sectionId: input.section.id,
          sectionHref: input.section.href,
          blockId: input.block.id,
          locator: input.locator,
          rect: {
            x,
            y: input.top + 4,
            width: 4,
            height: rect.height - 8
          },
          color: "rgba(59, 123, 163, 0.32)"
        } satisfies RectDrawOp);
        ops.push(
          ...this.buildWrappedTextOps({
            text: extractBlockText(input.block),
            section: input.section,
            blockId: input.block.id,
            locator: input.locator,
            x: x + 18,
            top: input.top + 2,
            width: Math.max(40, width - 18),
            height: rect.height,
            font: `400 ${input.typography.fontSize}px "Iowan Old Style", "Palatino Linotype", serif`,
            color: input.theme.color,
            highlighted: input.highlighted,
            active: input.active
          })
        );
        break;
      case "code":
        ops.push({
          kind: "rect",
          sectionId: input.section.id,
          sectionHref: input.section.href,
          blockId: input.block.id,
          locator: input.locator,
          rect,
          color: "rgba(15, 23, 42, 0.06)",
          radius: 12
        } satisfies RectDrawOp);
        ops.push(
          ...this.buildWrappedTextOps({
            text: input.block.text,
            section: input.section,
            blockId: input.block.id,
            locator: input.locator,
            x: x + 12,
            top: input.top + 12,
            width: Math.max(40, width - 24),
            height: rect.height - 24,
            font: `400 ${Math.max(13, input.typography.fontSize - 1)}px "SFMono-Regular", Consolas, monospace`,
            color: input.theme.color,
            highlighted: input.highlighted,
            active: input.active
          })
        );
        break;
      case "list":
      case "table":
      case "heading":
      case "text":
      default:
        ops.push(
          ...this.buildWrappedTextOps({
            text: extractBlockText(input.block),
            section: input.section,
            blockId: input.block.id,
            locator: input.locator,
            x,
            top: input.top,
            width,
            height: rect.height,
            font: `400 ${input.typography.fontSize}px "Iowan Old Style", "Palatino Linotype", serif`,
            color: input.theme.color,
            highlighted: input.highlighted,
            active: input.active
          })
        );
        break;
    }

    return {
      ops,
      interactions,
      height: input.estimatedHeight
    };
  }

  private buildWrappedTextOps(input: {
    text: string;
    section: SectionDocument;
    blockId: string;
    locator: Locator | undefined;
    x: number;
    top: number;
    width: number;
    height: number;
    font: string;
    color: string;
    highlighted: boolean;
    active: boolean;
  }): TextRunDrawOp[] {
    const fontSize = extractFontSize(input.font);
    const lineHeight = Math.max(fontSize * 1.45, 18);
    const lines = wrapText(input.text || "", input.width, input.font);
    return lines.map((line, index) => ({
      kind: "text",
      sectionId: input.section.id,
      sectionHref: input.section.href,
      blockId: input.blockId,
      locator: input.locator,
      rect: {
        x: input.x,
        y: input.top + index * lineHeight,
        width: approximateTextWidth(line, input.font),
        height: lineHeight
      },
      text: line,
      x: input.x,
      y: input.top + index * lineHeight,
      width: approximateTextWidth(line, input.font),
      font: input.font,
      color: input.color,
      highlightColor: input.highlighted
        ? "rgba(250, 204, 21, 0.28)"
        : input.active
          ? "rgba(245, 158, 11, 0.18)"
          : undefined,
      underline: undefined,
      href: undefined
    }));
  }

  private resolveLineStartX(
    textAlign: LayoutPretextBlock["textAlign"],
    left: number,
    width: number,
    lineWidth: number
  ): number {
    if (textAlign === "center") {
      return left + Math.max(0, (width - lineWidth) * 0.5);
    }
    if (textAlign === "end") {
      return left + Math.max(0, width - lineWidth);
    }
    return left;
  }

  private collectPretextText(block: LayoutPretextBlock): string {
    return block.lines
      .map((line) => line.fragments.map((fragment) => fragment.text).join(""))
      .join("\n");
  }
}

function extractFontSize(font: string): number {
  const match = font.match(/(\d+(?:\.\d+)?)px/);
  return match ? Number.parseFloat(match[1]!) : 16;
}

export function approximateTextWidth(text: string, font: string): number {
  const fontSize = extractFontSize(font);
  const wideChars = Array.from(text).filter((char) => char.charCodeAt(0) > 255).length;
  const asciiChars = Math.max(0, text.length - wideChars);
  return wideChars * fontSize * 0.92 + asciiChars * fontSize * 0.56;
}

function wrapText(text: string, maxWidth: number, font: string): string[] {
  if (!text) {
    return [""];
  }

  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/(\s+)/).filter((part) => part.length > 0);
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current}${word}` : word;
      if (approximateTextWidth(candidate, font) <= maxWidth || !current) {
        current = candidate;
        continue;
      }
      lines.push(current.trimEnd());
      current = word.trimStart();
    }
    lines.push(current.trimEnd());
  }

  return lines.map((line) => line || "");
}

function extractBlockText(block: BlockNode): string {
  switch (block.kind) {
    case "heading":
    case "text":
      return block.inlines
        .map((inline) => {
          switch (inline.kind) {
            case "text":
              return inline.text;
            case "code":
              return inline.text;
            case "emphasis":
            case "strong":
            case "link":
              return inline.children.map((child) => child.kind === "text" ? child.text : "").join("");
            case "line-break":
              return "\n";
            case "image":
              return inline.alt ?? "";
            default:
              return "";
          }
        })
        .join("");
    case "quote":
      return block.blocks.map(extractBlockText).join(" ");
    case "code":
      return block.text;
    case "image":
      return block.alt ?? "";
    case "list":
      return block.items.flatMap((item) => item.blocks.map(extractBlockText)).join(" ");
    case "table":
      return block.rows
        .flatMap((row) => row.cells.flatMap((cell) => cell.blocks.map(extractBlockText)))
        .join(" ");
    case "thematic-break":
      return "";
    default:
      return "";
  }
}
