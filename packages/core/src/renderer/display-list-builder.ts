import type {
  BlockNode,
  FigureBlock,
  InlineNode,
  ListBlock,
  Locator,
  Rect,
  SectionDocument,
  TableBlock,
  TextAlign,
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
import {
  buildReadingStyleProfile,
  type ReadingStyleProfile
} from "./reading-style-profile";
import { resolveImageLayout } from "../utils/image-layout";
import { wrapPreformattedText } from "../utils/preformatted-text";
import { extractBlockText } from "../utils/block-text";
import { approximateTextWidth, extractFontSize, wrapText } from "../utils/text-wrap";

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

type NativeBlockRenderStyle = {
  color: string;
  backgroundColor?: string;
  textAlign: TextAlign;
  paddingTop: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
};

export class DisplayListBuilder {
  buildSection(options: BuilderOptions): SectionDisplayList {
    const styleProfile = buildReadingStyleProfile({
      theme: options.theme,
      typography: options.typography
    });
    let currentTop = 0;
    const ops: DrawOp[] = [];
    const interactions: InteractionRegion[] = [];
    const contentWidth = Math.max(120, options.width);

    for (const block of options.blocks) {
      const built = block.type === "pretext"
        ? this.buildPretextBlock({
            block,
            section: options.section,
            top: currentTop,
            width: contentWidth,
            theme: options.theme,
            styleProfile,
            locator: options.locatorMap?.get(block.id),
            resolveImageLoaded: options.resolveImageLoaded,
            resolveImageUrl: options.resolveImageUrl,
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
            styleProfile,
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
      height: Math.max(
        currentTop + styleProfile.section.bottomPadding,
        options.typography.fontSize * 2 + styleProfile.section.bottomPadding
      ),
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
    styleProfile: ReadingStyleProfile;
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
    const ops: DrawOp[] = [];
    const interactions: InteractionRegion[] = [];
    const sidePadding = input.styleProfile.section.sidePadding;
    const blockRect = {
      x: sidePadding,
      y: input.top,
      width: input.width - sidePadding * 2,
      height: input.block.estimatedHeight
    };
    const contentRect = {
      x: blockRect.x + input.block.paddingLeft,
      y: blockRect.y + input.block.paddingTop,
      width: Math.max(40, blockRect.width - input.block.paddingLeft - input.block.paddingRight),
      height: Math.max(0, blockRect.height - input.block.paddingTop - input.block.paddingBottom)
    }
    if (input.block.backgroundColor) {
      ops.push({
        kind: "rect",
        sectionId: input.section.id,
        sectionHref: input.section.href,
        blockId: input.block.id,
        locator: input.locator,
        rect: blockRect,
        color: input.block.backgroundColor,
        radius: 10
      } satisfies RectDrawOp)
    }
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

    let lineTop = contentRect.y
    input.block.lines.forEach((line) => {
      const lineWidth = Math.max(0, line.width);
      const startX = this.resolveLineStartX(
        input.block.textAlign,
        contentRect.x,
        contentRect.width,
        lineWidth
      );
      let cursorX = startX;
      const lineHeight = line.height

      for (const fragment of line.fragments) {
        cursorX += fragment.gapBefore;
        const fragmentWidth = fragment.image?.width ?? approximateTextWidth(fragment.text, fragment.font);
        const baselineShift = fragment.baselineShift ?? 0
        if (fragment.image) {
          const imageRect = {
            x: cursorX,
            y: lineTop + Math.max(0, (lineHeight - fragment.image.height) * 0.5),
            width: fragment.image.width,
            height: fragment.image.height
          }
          const renderSrc = input.resolveImageUrl?.(fragment.image.src) ?? fragment.image.src
          ops.push({
            kind: "image",
            sectionId: input.section.id,
            sectionHref: input.section.href,
            blockId: input.block.id,
            locator: input.locator,
            rect: imageRect,
            src: renderSrc,
            alt: fragment.image.alt,
            loaded: Boolean(input.resolveImageLoaded?.(fragment.image.src)),
            background: "transparent"
          } satisfies ImageDrawOp)
          interactions.push({
            kind: "image",
            rect: imageRect,
            sectionId: input.section.id,
            blockId: input.block.id,
            src: renderSrc,
            alt: fragment.image.alt,
            locator: input.locator
          })
          cursorX += fragment.image.width;
          continue
        }
        const rect = {
          x: cursorX,
          y: lineTop + baselineShift,
          width: fragmentWidth,
          height: lineHeight
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
        y: lineTop + baselineShift,
        width: fragmentWidth,
        font: fragment.font,
        color: fragment.href
          ? input.styleProfile.link.color
          : (fragment.color ?? input.block.color ?? input.theme.color),
        backgroundColor: fragment.backgroundColor,
        highlightColor: input.highlighted
          ? input.styleProfile.highlight.search
          : input.active
            ? input.styleProfile.highlight.active
            : fragment.mark
              ? input.styleProfile.highlight.mark
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

      lineTop += lineHeight
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
    styleProfile: ReadingStyleProfile;
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
    const x = input.styleProfile.section.sidePadding;
    const width = input.width - input.styleProfile.section.sidePadding * 2;
    const rect = {
      x,
      y: input.top,
      width,
      height: input.estimatedHeight
    };
    const blockStyle = this.resolveNativeBlockRenderStyle(
      input.block,
      input.theme,
      input.styleProfile
    );
    const contentRect = this.insetRect(rect, blockStyle);
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

    if (blockStyle.backgroundColor) {
      ops.push({
        kind: "rect",
        sectionId: input.section.id,
        sectionHref: input.section.href,
        blockId: input.block.id,
        locator: input.locator,
        rect,
        color: blockStyle.backgroundColor,
        radius: 12
      } satisfies RectDrawOp);
    }

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
          ? input.styleProfile.highlight.active
          : input.styleProfile.highlight.mark,
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
          ...(input.block.height ? { intrinsicHeight: input.block.height } : {}),
          fillWidth: this.isCoverImageBlock(input.section, input.block)
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
          color: input.styleProfile.thematicBreak.color,
          lineWidth: input.styleProfile.thematicBreak.lineWidth,
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
            width: input.styleProfile.quote.accentWidth,
            height: rect.height - 8
          },
          color: input.styleProfile.quote.accentColor
        } satisfies RectDrawOp);
        ops.push(
          ...this.buildWrappedTextOps({
            text: extractBlockText(input.block),
            section: input.section,
            blockId: input.block.id,
            locator: input.locator,
            x: contentRect.x + input.styleProfile.quote.accentGap,
            top: contentRect.y + input.styleProfile.quote.contentInsetY,
            width: Math.max(40, contentRect.width - input.styleProfile.quote.accentGap),
            height: contentRect.height,
            font: `400 ${input.typography.fontSize}px "Iowan Old Style", "Palatino Linotype", serif`,
            color: blockStyle.color,
            textAlign: blockStyle.textAlign,
            highlighted: input.highlighted,
            active: input.active,
            styleProfile: input.styleProfile
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
          color: blockStyle.backgroundColor ?? input.styleProfile.code.blockBackground,
          radius: input.styleProfile.code.blockRadius
        } satisfies RectDrawOp);
        ops.push(
          ...this.buildPreformattedTextOps({
            text: input.block.text,
            section: input.section,
            blockId: input.block.id,
            locator: input.locator,
            x: contentRect.x + input.styleProfile.code.blockPaddingX,
            top: contentRect.y + input.styleProfile.code.blockPaddingY,
            width: Math.max(40, contentRect.width - input.styleProfile.code.blockPaddingX * 2),
            height: Math.max(0, contentRect.height - input.styleProfile.code.blockPaddingY * 2),
            font: `400 ${input.styleProfile.code.fontSize}px ${input.styleProfile.code.fontFamily}`,
            color: blockStyle.color,
            textAlign: blockStyle.textAlign,
            highlighted: input.highlighted,
            active: input.active,
            styleProfile: input.styleProfile
          })
        );
        break;
      case "aside":
        ops.push({
          kind: "rect",
          sectionId: input.section.id,
          sectionHref: input.section.href,
          blockId: input.block.id,
          locator: input.locator,
          rect,
          color: blockStyle.backgroundColor ?? "rgba(59, 123, 163, 0.08)",
          radius: 12
        } satisfies RectDrawOp)
        ops.push({
          kind: "rect",
          sectionId: input.section.id,
          sectionHref: input.section.href,
          blockId: input.block.id,
          locator: input.locator,
          rect: {
            x,
            y: input.top + 6,
            width: input.styleProfile.aside.accentWidth,
            height: Math.max(16, rect.height - 12)
          },
          color: input.styleProfile.aside.accentColor,
          radius: 4
        } satisfies RectDrawOp)
        ops.push(
          ...this.buildWrappedTextOps({
            text: extractBlockText(input.block),
            section: input.section,
            blockId: input.block.id,
            locator: input.locator,
            x: contentRect.x + input.styleProfile.aside.accentGap,
            top: contentRect.y + input.styleProfile.aside.contentInsetY,
            width: Math.max(40, contentRect.width - input.styleProfile.aside.accentGap),
            height: Math.max(0, contentRect.height - input.styleProfile.aside.contentInsetY * 2),
            font: `400 ${input.typography.fontSize}px "Iowan Old Style", "Palatino Linotype", serif`,
            color: blockStyle.color,
            textAlign: blockStyle.textAlign,
            highlighted: input.highlighted,
            active: input.active,
            styleProfile: input.styleProfile
          })
        );
        break;
      case "list":
        ops.push(
          ...this.buildListBlockOps({
            block: input.block,
            section: input.section,
            locator: input.locator,
            x: contentRect.x,
            top: contentRect.y + 4,
            width: contentRect.width,
            typography: input.typography,
            theme: {
              ...input.theme,
              color: blockStyle.color
            },
            highlighted: input.highlighted,
            active: input.active,
            styleProfile: input.styleProfile
          })
        );
        break;
      case "figure":
        ops.push(
          ...this.buildFigureBlockOps({
            block: input.block,
            section: input.section,
            locator: input.locator,
            x: contentRect.x,
            top: contentRect.y + 6,
            width: contentRect.width,
            viewportHeight: input.viewportHeight,
            typography: input.typography,
            theme: {
              ...input.theme,
              color: blockStyle.color
            },
            resolveImageLoaded: input.resolveImageLoaded,
            resolveImageUrl: input.resolveImageUrl,
            highlighted: input.highlighted,
            active: input.active,
            styleProfile: input.styleProfile
          })
        );
        break;
      case "table":
        ops.push(
          ...this.buildTableBlockOps({
            block: input.block,
            section: input.section,
            locator: input.locator,
            x: contentRect.x,
            top: contentRect.y + 4,
            width: contentRect.width,
            typography: input.typography,
            theme: {
              ...input.theme,
              color: blockStyle.color
            },
            highlighted: input.highlighted,
            active: input.active,
            styleProfile: input.styleProfile
          })
        );
        break;
      case "heading":
      case "text":
      default:
        ops.push(
          ...this.buildWrappedTextOps({
            text: extractBlockText(input.block),
            section: input.section,
            blockId: input.block.id,
            locator: input.locator,
            x: contentRect.x,
            top: contentRect.y,
            width: contentRect.width,
            height: contentRect.height,
            font: `400 ${input.typography.fontSize}px "Iowan Old Style", "Palatino Linotype", serif`,
            color: blockStyle.color,
            textAlign: blockStyle.textAlign,
            highlighted: input.highlighted,
            active: input.active,
            styleProfile: input.styleProfile
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
    textAlign: TextAlign;
    highlighted: boolean;
    active: boolean;
    styleProfile: ReadingStyleProfile;
  }): TextRunDrawOp[] {
    const fontSize = extractFontSize(input.font);
    const lineHeight = Math.max(fontSize * 1.45, 18);
    const lines = wrapText(input.text || "", input.width, input.font);
    return lines.map((line, index) => {
      const lineWidth = approximateTextWidth(line, input.font)
      const lineX = this.resolveTextLineStartX(
        input.textAlign,
        input.x,
        input.width,
        lineWidth
      )
      return {
        kind: "text",
        sectionId: input.section.id,
        sectionHref: input.section.href,
        blockId: input.blockId,
        locator: input.locator,
        rect: {
          x: lineX,
          y: input.top + index * lineHeight,
          width: lineWidth,
          height: lineHeight
        },
        text: line,
        x: lineX,
        y: input.top + index * lineHeight,
        width: lineWidth,
        font: input.font,
        color: input.color,
        backgroundColor: undefined,
        highlightColor: input.highlighted
          ? input.styleProfile.highlight.search
          : input.active
            ? input.styleProfile.highlight.active
            : undefined,
        underline: undefined,
        href: undefined
      }
    })
  }

  private buildPreformattedTextOps(input: {
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
    textAlign: TextAlign;
    highlighted: boolean;
    active: boolean;
    styleProfile: ReadingStyleProfile;
  }): TextRunDrawOp[] {
    const fontSize = extractFontSize(input.font)
    const lineHeight = Math.max(fontSize * 1.45, 18)
    const lines = wrapPreformattedText(input.text || "", input.width, input.font)
    return lines.map((line, index) => {
      const lineWidth = approximateTextWidth(line, input.font)
      const lineX = this.resolveTextLineStartX(
        input.textAlign,
        input.x,
        input.width,
        lineWidth
      )
      return {
        kind: "text",
        sectionId: input.section.id,
        sectionHref: input.section.href,
        blockId: input.blockId,
        locator: input.locator,
        rect: {
          x: lineX,
          y: input.top + index * lineHeight,
          width: lineWidth,
          height: lineHeight
        },
        text: line,
        x: lineX,
        y: input.top + index * lineHeight,
        width: lineWidth,
        font: input.font,
        color: input.color,
        backgroundColor: undefined,
        highlightColor: input.highlighted
          ? input.styleProfile.highlight.search
          : input.active
            ? input.styleProfile.highlight.active
            : undefined,
        underline: undefined,
        href: undefined
      }
    })
  }

  private buildListBlockOps(input: {
    block: ListBlock;
    section: SectionDocument;
    locator: Locator | undefined;
    x: number;
    top: number;
    width: number;
    typography: TypographyOptions;
    theme: Theme;
    highlighted: boolean;
    active: boolean;
    styleProfile: ReadingStyleProfile;
  }): TextRunDrawOp[] {
    const ops: TextRunDrawOp[] = []
    const font = `400 ${input.typography.fontSize}px "Iowan Old Style", "Palatino Linotype", serif`
    const lineHeight = Math.max(input.typography.fontSize * 1.45, 18)
    const renderList = (block: ListBlock, depth: number, top: number): number => {
      let currentTop = top
      block.items.forEach((item, index) => {
        const marker = block.ordered ? `${(block.start ?? 1) + index}.` : "\u2022"
        const markerX = input.x + depth * input.styleProfile.list.indent
        const textX = markerX + input.styleProfile.list.markerGap
        const textWidth = Math.max(40, input.width - (textX - input.x))
        const textBlocks = item.blocks.filter((child) => child.kind !== "list")
        const itemText = textBlocks.map(extractBlockText).filter(Boolean).join(" ")
        const itemLines = wrapText(itemText || "", textWidth, font)

        ops.push({
          kind: "text",
          sectionId: input.section.id,
          sectionHref: input.section.href,
          blockId: input.block.id,
          locator: input.locator,
          rect: {
            x: markerX,
            y: currentTop,
          width: approximateTextWidth(marker, font),
          height: lineHeight
        },
        text: marker,
        x: markerX,
        y: currentTop,
        width: approximateTextWidth(marker, font),
        font,
        color: input.theme.color,
        backgroundColor: undefined,
        highlightColor: input.highlighted
            ? input.styleProfile.highlight.search
            : input.active
              ? input.styleProfile.highlight.active
              : undefined,
          underline: undefined,
          href: undefined
        })

        itemLines.forEach((line, lineIndex) => {
          ops.push({
            kind: "text",
            sectionId: input.section.id,
            sectionHref: input.section.href,
            blockId: input.block.id,
            locator: input.locator,
            rect: {
              x: textX,
              y: currentTop + lineIndex * lineHeight,
            width: approximateTextWidth(line, font),
            height: lineHeight
          },
          text: line,
          x: textX,
          y: currentTop + lineIndex * lineHeight,
          width: approximateTextWidth(line, font),
          font,
          color: input.theme.color,
          backgroundColor: undefined,
          highlightColor: input.highlighted
              ? input.styleProfile.highlight.search
              : input.active
                ? input.styleProfile.highlight.active
                : undefined,
            underline: undefined,
            href: undefined
          })
        })

        currentTop +=
          Math.max(lineHeight, itemLines.length * lineHeight) +
          input.styleProfile.list.itemGap
        for (const child of item.blocks) {
          if (child.kind === "list") {
            currentTop = renderList(child, depth + 1, currentTop)
          }
        }
      })

      return currentTop
    }

    renderList(input.block, 0, input.top)
    return ops
  }

  private isCoverImageBlock(
    section: SectionDocument,
    block: BlockNode
  ): block is Extract<BlockNode, { kind: "image" }> {
    return section.presentationRole === "cover" && section.blocks.length === 1 && block.kind === "image"
  }

  private buildFigureBlockOps(input: {
    block: FigureBlock;
    section: SectionDocument;
    locator: Locator | undefined;
    x: number;
    top: number;
    width: number;
    viewportHeight: number;
    typography: TypographyOptions;
    theme: Theme;
    resolveImageLoaded: ((src: string) => boolean) | undefined;
    resolveImageUrl: ((src: string) => string) | undefined;
    highlighted: boolean;
    active: boolean;
    styleProfile: ReadingStyleProfile;
  }): DrawOp[] {
    const ops: DrawOp[] = []
    let currentTop = input.top

    for (const child of input.block.blocks) {
      if (child.kind === "image") {
        const renderSrc = input.resolveImageUrl?.(child.src) ?? child.src
        const imageLayout = resolveImageLayout({
          availableWidth: input.width,
          viewportHeight: input.viewportHeight,
          ...(child.width ? { intrinsicWidth: child.width } : {}),
          ...(child.height ? { intrinsicHeight: child.height } : {})
        })
        const imageRect = {
          x: input.x + imageLayout.xOffset,
          y: currentTop,
          width: imageLayout.width,
          height: imageLayout.height
        }
        ops.push({
          kind: "image",
          sectionId: input.section.id,
          sectionHref: input.section.href,
          blockId: input.block.id,
          locator: input.locator,
          rect: imageRect,
          src: renderSrc,
          alt: child.alt,
          loaded: Boolean(input.resolveImageLoaded?.(child.src)),
          background: "transparent"
        })
        currentTop += imageLayout.height + input.styleProfile.text.marginBottom
        continue
      }

      const text = extractBlockText(child)
      if (!text) {
        continue
      }
      const font = `400 ${input.typography.fontSize}px "Iowan Old Style", "Palatino Linotype", serif`
      const lineHeight = Math.max(input.typography.fontSize * 1.45, 18)
      const lines = wrapText(text, input.width, font)
      lines.forEach((line, lineIndex) => {
        ops.push({
          kind: "text",
          sectionId: input.section.id,
          sectionHref: input.section.href,
          blockId: input.block.id,
          locator: input.locator,
          rect: {
            x: input.x,
            y: currentTop + lineIndex * lineHeight,
          width: approximateTextWidth(line, font),
          height: lineHeight
        },
        text: line,
        x: input.x,
        y: currentTop + lineIndex * lineHeight,
        width: approximateTextWidth(line, font),
        font,
        color: input.theme.color,
        backgroundColor: undefined,
        highlightColor: input.highlighted
            ? input.styleProfile.highlight.search
            : input.active
              ? input.styleProfile.highlight.active
              : undefined,
          underline: undefined,
          href: undefined
        })
      })
      currentTop += lines.length * lineHeight + input.styleProfile.text.marginBottom
    }

    if (input.block.caption?.length) {
      const captionText = input.block.caption.map(extractBlockText).filter(Boolean).join(" ")
      const captionFont = `italic 400 ${Math.max(14, input.typography.fontSize - 1)}px "Iowan Old Style", "Palatino Linotype", serif`
      const captionLineHeight = Math.max(extractFontSize(captionFont) * 1.45, 18)
      const captionLines = wrapText(
        captionText,
        Math.max(40, input.width - input.styleProfile.code.blockPaddingX * 2),
        captionFont
      )
      captionLines.forEach((line, lineIndex) => {
        ops.push({
          kind: "text",
          sectionId: input.section.id,
          sectionHref: input.section.href,
          blockId: input.block.id,
          locator: input.locator,
          rect: {
            x: input.x + input.styleProfile.code.blockPaddingX,
            y: currentTop + lineIndex * captionLineHeight,
            width: approximateTextWidth(line, captionFont),
            height: captionLineHeight
          },
          text: line,
          x: input.x + input.styleProfile.code.blockPaddingX,
          y: currentTop + lineIndex * captionLineHeight,
          width: approximateTextWidth(line, captionFont),
          font: captionFont,
          color: input.theme.color,
          backgroundColor: undefined,
          highlightColor: input.highlighted
            ? input.styleProfile.highlight.search
            : input.active
              ? input.styleProfile.highlight.active
              : undefined,
          underline: undefined,
          href: undefined
        })
      })
    }

    return ops
  }

  private buildTableBlockOps(input: {
    block: TableBlock;
    section: SectionDocument;
    locator: Locator | undefined;
    x: number;
    top: number;
    width: number;
    typography: TypographyOptions;
    theme: Theme;
    highlighted: boolean;
    active: boolean;
    styleProfile: ReadingStyleProfile;
  }): DrawOp[] {
    const ops: DrawOp[] = []
    const captionFont = `italic 400 ${Math.max(14, input.typography.fontSize - 1)}px "Iowan Old Style", "Palatino Linotype", serif`
    const cellFont = `400 ${input.typography.fontSize}px "Iowan Old Style", "Palatino Linotype", serif`
    const headerFont = `700 ${input.typography.fontSize}px "Iowan Old Style", "Palatino Linotype", serif`
    const lineHeight = Math.max(input.typography.fontSize * 1.45, 18)
    const padding = input.styleProfile.table.cellPadding
    let currentTop = input.top

    if (input.block.caption?.length) {
      const captionText = input.block.caption.map(extractBlockText).filter(Boolean).join(" ")
      const captionLines = wrapText(captionText, input.width, captionFont)
      captionLines.forEach((line, lineIndex) => {
        ops.push({
          kind: "text",
          sectionId: input.section.id,
          sectionHref: input.section.href,
          blockId: input.block.id,
          locator: input.locator,
          rect: {
            x: input.x,
            y: currentTop + lineIndex * lineHeight,
            width: approximateTextWidth(line, captionFont),
            height: lineHeight
          },
          text: line,
          x: input.x,
          y: currentTop + lineIndex * lineHeight,
          width: approximateTextWidth(line, captionFont),
          font: captionFont,
          color: input.theme.color,
          backgroundColor: undefined,
          highlightColor: input.highlighted
            ? input.styleProfile.highlight.search
            : input.active
              ? input.styleProfile.highlight.active
              : undefined,
          underline: undefined,
          href: undefined
        })
      })
      currentTop += captionLines.length * lineHeight + input.styleProfile.text.marginBottom
    }

    const columnCount = Math.max(
      1,
      ...input.block.rows.map((row) =>
        row.cells.reduce((total, cell) => total + (cell.colSpan ?? 1), 0)
      )
    )
    const columnWidth = input.width / columnCount

    for (const row of input.block.rows) {
      const cellHeights = row.cells.map((cell) => {
        const span = Math.max(1, cell.colSpan ?? 1)
        const cellWidth = Math.max(32, columnWidth * span - padding * 2)
        const font = cell.header ? headerFont : cellFont
        const text = cell.blocks.map(extractBlockText).filter(Boolean).join(" ")
        return wrapText(text || "", cellWidth, font).length * lineHeight + padding * 2
      })
      const rowHeight = Math.max(lineHeight + padding * 2, ...cellHeights)
      let currentX = input.x

      row.cells.forEach((cell) => {
        const span = Math.max(1, cell.colSpan ?? 1)
        const cellWidth = columnWidth * span
        const font = cell.header ? headerFont : cellFont
        const text = cell.blocks.map(extractBlockText).filter(Boolean).join(" ")
        const lines = wrapText(text || "", Math.max(32, cellWidth - padding * 2), font)

        ops.push({
          kind: "rect",
          sectionId: input.section.id,
          sectionHref: input.section.href,
          blockId: input.block.id,
          locator: input.locator,
          rect: {
            x: currentX,
            y: currentTop,
            width: cellWidth,
            height: rowHeight
          },
          color: cell.header ? "rgba(148, 163, 184, 0.10)" : "rgba(255, 255, 255, 0.001)",
          strokeColor: input.styleProfile.table.borderColor,
          strokeWidth: input.styleProfile.table.borderWidth
        })

        lines.forEach((line, lineIndex) => {
          ops.push({
            kind: "text",
            sectionId: input.section.id,
            sectionHref: input.section.href,
            blockId: input.block.id,
            locator: input.locator,
            rect: {
              x: currentX + padding,
              y: currentTop + padding + lineIndex * lineHeight,
            width: approximateTextWidth(line, font),
            height: lineHeight
          },
          text: line,
          x: currentX + padding,
          y: currentTop + padding + lineIndex * lineHeight,
          width: approximateTextWidth(line, font),
          font,
          color: input.theme.color,
          backgroundColor: undefined,
          highlightColor: input.highlighted
              ? input.styleProfile.highlight.search
              : input.active
                ? input.styleProfile.highlight.active
                : undefined,
            underline: undefined,
            href: undefined
          })
        })

        currentX += cellWidth
      })

      currentTop += rowHeight
    }

    return ops
  }

  private resolveLineStartX(
    textAlign: LayoutPretextBlock["textAlign"],
    left: number,
    width: number,
    lineWidth: number
  ): number {
    return this.resolveTextLineStartX(textAlign, left, width, lineWidth);
  }

  private resolveTextLineStartX(
    textAlign: TextAlign,
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

  private insetRect(rect: Rect, style: NativeBlockRenderStyle): Rect {
    return {
      x: rect.x + style.paddingLeft,
      y: rect.y + style.paddingTop,
      width: Math.max(40, rect.width - style.paddingLeft - style.paddingRight),
      height: Math.max(0, rect.height - style.paddingTop - style.paddingBottom)
    }
  }

  private resolveNativeBlockRenderStyle(
    block: BlockNode,
    theme: Theme,
    styleProfile: ReadingStyleProfile
  ): NativeBlockRenderStyle {
    return {
      color: block.style?.color ?? theme.color,
      ...(block.style?.backgroundColor
        ? { backgroundColor: block.style.backgroundColor }
        : block.kind === "aside" || block.kind === "nav"
          ? { backgroundColor: styleProfile.aside.background }
        : {}),
      textAlign: block.style?.textAlign ?? "start",
      paddingTop: block.style?.paddingTop ?? 0,
      paddingBottom: block.style?.paddingBottom ?? 0,
      paddingLeft: block.style?.paddingLeft ?? 0,
      paddingRight: block.style?.paddingRight ?? 0
    }
  }

  private collectPretextText(block: LayoutPretextBlock): string {
    return block.lines
      .map((line) =>
        line.fragments.map((fragment) => fragment.image?.alt ?? fragment.text).join("")
      )
      .join("\n");
  }
}
