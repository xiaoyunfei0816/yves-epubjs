import {
  materializeRichInlineLineRange,
  prepareRichInline,
  walkRichInlineLineRanges,
  type PreparedRichInline,
  type RichInlineItem,
  type RichInlineLine,
  type RichInlineLineRange
} from "@chenglou/pretext/rich-inline";
import type {
  BlockNode,
  FigureBlock,
  HeadingBlock,
  InlineNode,
  ListBlock,
  Locator,
  ReadingMode,
  SectionDocument,
  TableBlock,
  TextAlign,
  TextBlock,
  TypographyOptions
} from "../model/types";
import { resolveImageLayout } from "../utils/image-layout";
import { countWrappedPreformattedLines } from "../utils/preformatted-text";
import { extractBlockText } from "../utils/block-text";
import { estimateWrappedTextHeight } from "../utils/text-wrap";

export type LayoutInlineFragment = {
  text: string;
  font: string;
  gapBefore: number;
  color?: string;
  backgroundColor?: string;
  image?: {
    src: string;
    alt?: string;
    title?: string;
    width: number;
    height: number;
  };
  href?: string;
  title?: string;
  code?: boolean;
  mark?: boolean;
  baselineShift?: number;
};

export type LayoutTextLine = {
  width: number;
  fragments: LayoutInlineFragment[];
};

export type LayoutPretextBlock = {
  type: "pretext";
  id: string;
  kind: "text" | "heading";
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  lineHeight: number;
  textAlign: TextAlign;
  color?: string;
  backgroundColor?: string;
  paddingTop: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
  lines: LayoutTextLine[];
  estimatedHeight: number;
};

export type LayoutNativeBlock = {
  type: "native";
  id: string;
  block: BlockNode;
  estimatedHeight: number;
};

export type LayoutBlock = LayoutPretextBlock | LayoutNativeBlock;

export type LayoutResult = {
  mode: ReadingMode;
  width: number;
  blocks: LayoutBlock[];
  locatorMap: Map<string, Locator>;
};

export type LayoutInput = {
  section: SectionDocument;
  spineIndex: number;
  viewportWidth: number;
  viewportHeight: number;
  typography: TypographyOptions;
  fontFamily: string;
};

type InlineStyleState = {
  fontStyle?: "normal" | "italic";
  fontWeight?: string;
  href?: string;
  title?: string;
  code?: boolean;
  fontScale?: number;
  mark?: boolean;
  verticalAlign?: "sub" | "sup";
  color?: string;
  backgroundColor?: string;
};

type RichInlineSource = LayoutInlineFragment;

type CompiledSegment = {
  prepared: PreparedRichInline;
  sources: RichInlineSource[];
};

type CompiledBlock = {
  segments: CompiledSegment[];
  lineHeight: number;
  textAlign: TextAlign;
};

const HEADING_SCALE: Record<HeadingBlock["level"], number> = {
  1: 2,
  2: 1.7,
  3: 1.45,
  4: 1.25,
  5: 1.1,
  6: 1
};

const DEFAULT_FONT_FAMILY = '"Iowan Old Style", "Palatino Linotype", serif';

export class LayoutEngine {
  private readonly compiledBlocks = new Map<string, CompiledBlock>();

  layout(input: LayoutInput, mode: ReadingMode): LayoutResult {
    const width = Math.max(120, Math.floor(input.viewportWidth));
    const blocks: LayoutBlock[] = [];
    const locatorMap = new Map<string, Locator>();

    for (const block of input.section.blocks) {
      locatorMap.set(block.id, {
        spineIndex: input.spineIndex,
        blockId: block.id,
        progressInSection: 0
      });

      const pretextBlock = this.layoutTextLikeBlock(block, input, width);
      if (pretextBlock) {
        blocks.push(pretextBlock);
        continue;
      }

      blocks.push({
        type: "native",
        id: block.id,
        block,
        estimatedHeight: this.estimateNativeBlockHeight(block, input)
      });
    }

    return {
      mode,
      width,
      blocks,
      locatorMap
    };
  }

  private layoutTextLikeBlock(
    block: BlockNode,
    input: LayoutInput,
    width: number
  ): LayoutPretextBlock | null {
    if (block.kind !== "text" && block.kind !== "heading") {
      return null;
    }

    const compiled = this.getCompiledBlock(block, input);
    if (!compiled) {
      return null;
    }

    const paddingTop = block.style?.paddingTop ?? 0
    const paddingBottom = block.style?.paddingBottom ?? 0
    const paddingLeft = block.style?.paddingLeft ?? 0
    const paddingRight = block.style?.paddingRight ?? 0
    const contentWidth = Math.max(40, width - paddingLeft - paddingRight)
    const lines: LayoutTextLine[] = [];
    for (const segment of compiled.segments) {
      const lineCountBefore = lines.length
      walkRichInlineLineRanges(segment.prepared, contentWidth, (range: RichInlineLineRange) => {
        const materialized = materializeRichInlineLineRange(segment.prepared, range);
        lines.push(this.materializeLine(segment.sources, materialized));
      });

      if (lines.length === lineCountBefore) {
        lines.push({
          width: 0,
          fragments: []
        })
      }
    }

    if (lines.length === 0) {
      lines.push({
        width: 0,
        fragments: []
      });
    }

    if (block.kind === "heading") {
      return {
        type: "pretext",
        id: block.id,
        kind: block.kind,
        level: block.level,
        lineHeight: compiled.lineHeight,
        textAlign: compiled.textAlign,
        ...(block.style?.color ? { color: block.style.color } : {}),
        ...(block.style?.backgroundColor ? { backgroundColor: block.style.backgroundColor } : {}),
        paddingTop,
        paddingBottom,
        paddingLeft,
        paddingRight,
        lines,
        estimatedHeight:
          this.estimatePretextHeight(lines.length, compiled.lineHeight, block.kind) +
          paddingTop +
          paddingBottom
      };
    }

    return {
      type: "pretext",
      id: block.id,
      kind: block.kind,
      lineHeight: compiled.lineHeight,
      textAlign: compiled.textAlign,
      ...(block.style?.color ? { color: block.style.color } : {}),
      ...(block.style?.backgroundColor ? { backgroundColor: block.style.backgroundColor } : {}),
      paddingTop,
      paddingBottom,
      paddingLeft,
      paddingRight,
      lines,
      estimatedHeight:
        this.estimatePretextHeight(lines.length, compiled.lineHeight, block.kind) +
        paddingTop +
        paddingBottom
    };
  }

  private materializeLine(
    sources: RichInlineSource[],
    line: RichInlineLine
  ): LayoutTextLine {
    return {
      width: line.width,
      fragments: line.fragments.map((fragment) => {
        const options = sourceToFragmentOptions(sources[fragment.itemIndex])
        return this.createSourceFragment(
          options.image ? "" : fragment.text,
          options,
          fragment.gapBefore
        )
      })
    };
  }

  private getCompiledBlock(block: TextBlock | HeadingBlock, input: LayoutInput): CompiledBlock | null {
    if (this.containsUnsupportedInline(block.inlines)) {
      return null;
    }

    const key = this.getBlockCacheKey(block, input);
    const cached = this.compiledBlocks.get(key);
    if (cached) {
      return cached;
    }

    const baseFontSize =
      block.kind === "heading"
        ? (block.style?.fontSize ?? input.typography.fontSize * HEADING_SCALE[block.level])
        : (block.style?.fontSize ?? input.typography.fontSize);
    const lineHeight =
      block.style?.lineHeight ??
      (block.kind === "heading"
        ? Math.max(baseFontSize * 1.25, input.typography.fontSize * input.typography.lineHeight)
        : input.typography.fontSize * input.typography.lineHeight);

    const segments = this.compileInlineSegments(
      block.inlines,
      {
        fontFamily: input.fontFamily,
        fontSize: baseFontSize
      },
      {
        ...(block.style?.fontStyle ? { fontStyle: block.style.fontStyle } : {}),
        ...(block.style?.fontWeight ? { fontWeight: block.style.fontWeight } : {}),
        ...(block.style?.color ? { color: block.style.color } : {}),
        ...(block.style?.backgroundColor ? { backgroundColor: block.style.backgroundColor } : {})
      }
    )

    const compiled = {
      segments,
      lineHeight,
      textAlign: block.style?.textAlign ?? "start"
    } satisfies CompiledBlock;

    this.compiledBlocks.set(key, compiled);
    return compiled;
  }

  private compileInlineSegments(
    inlines: InlineNode[],
    typography: {
      fontFamily: string;
      fontSize: number;
    },
    state: InlineStyleState
  ): CompiledSegment[] {
    const segments: CompiledSegment[] = []
    let items: RichInlineItem[] = []
    let sources: RichInlineSource[] = []

    const flushSegment = (): void => {
      if (items.length === 0) {
        segments.push({
          prepared: prepareRichInline([
            { text: "", font: this.buildFont(typography.fontFamily, typography.fontSize, state) }
          ]),
          sources: [
            this.createSourceFragment(
              "",
              { font: this.buildFont(typography.fontFamily, typography.fontSize, state) },
              0
            )
          ]
        })
      } else {
        segments.push({
          prepared: prepareRichInline([...items]),
          sources: [...sources]
        })
      }

      items.length = 0
      sources.length = 0
    }

    this.collectRichInlineItems(
      inlines,
      typography,
      state,
      items,
      sources,
      flushSegment
    )

    if (segments.length === 0 || items.length > 0 || sources.length > 0) {
      flushSegment()
    }

    return segments
  }

  private collectRichInlineItems(
    inlines: InlineNode[],
    typography: {
      fontFamily: string;
      fontSize: number;
    },
    state: InlineStyleState,
    items: RichInlineItem[],
    sources: RichInlineSource[],
    breakLine: () => void
  ): void {
    for (const inline of inlines) {
      switch (inline.kind) {
        case "text": {
          if (!inline.text) {
            continue;
          }

          const effectiveFontSize = typography.fontSize * (state.fontScale ?? 1);
          const font = this.buildFont(typography.fontFamily, effectiveFontSize, state);
          items.push({
            text: inline.text,
            font
          });
          sources.push(
            this.createSourceFragment(
              inline.text,
              {
                font,
                ...(state.href ? { href: state.href } : {}),
                ...(state.title ? { title: state.title } : {}),
                ...(state.code ? { code: true } : {}),
                ...(state.mark ? { mark: true } : {}),
                ...(state.color ? { color: state.color } : {}),
                ...(state.backgroundColor ? { backgroundColor: state.backgroundColor } : {}),
                ...(state.verticalAlign
                  ? {
                      baselineShift:
                        effectiveFontSize * (state.verticalAlign === "sup" ? -0.28 : 0.18)
                    }
                  : {})
              },
              0
            )
          );
          break;
        }
        case "emphasis":
        case "span":
        case "del":
        case "ins":
        case "sub":
        case "sup":
        case "small":
        case "mark":
          this.collectRichInlineItems(
            inline.children,
            typography,
            {
              ...state,
              ...(inline.kind === "emphasis" ? { fontStyle: "italic" as const } : {}),
              ...(inline.kind === "small" ? { fontScale: (state.fontScale ?? 1) * 0.85 } : {}),
              ...(inline.kind === "sub" || inline.kind === "sup"
                ? { fontScale: (state.fontScale ?? 1) * 0.83 }
                : {}),
              ...(inline.kind === "mark" ? { mark: true } : {}),
              ...(inline.style?.fontStyle ? { fontStyle: inline.style.fontStyle } : {}),
              ...(inline.style?.fontWeight ? { fontWeight: inline.style.fontWeight } : {}),
              ...(inline.style?.color ? { color: inline.style.color } : {}),
              ...(inline.style?.backgroundColor
                ? { backgroundColor: inline.style.backgroundColor }
                : {}),
              ...(inline.kind === "sub"
                ? { verticalAlign: "sub" as const }
                : inline.kind === "sup"
                  ? { verticalAlign: "sup" as const }
                  : {})
            },
            items,
            sources,
            breakLine
          );
          break;
        case "strong":
          this.collectRichInlineItems(
            inline.children,
            typography,
            {
              ...state,
              fontWeight: inline.style?.fontWeight ?? "700",
              ...(inline.style?.color ? { color: inline.style.color } : {}),
              ...(inline.style?.backgroundColor
                ? { backgroundColor: inline.style.backgroundColor }
                : {})
            },
            items,
            sources,
            breakLine
          );
          break;
        case "link":
          this.collectRichInlineItems(
            inline.children,
            typography,
            {
              ...state,
              href: inline.href,
              ...(inline.title ? { title: inline.title } : {})
            },
            items,
            sources,
            breakLine
          );
          break;
        case "code": {
          const font = this.buildFont('"SFMono-Regular", "SF Mono", Consolas, monospace', typography.fontSize * (state.fontScale ?? 1) * 0.94, {
            ...state,
            code: true
          });
          items.push({
            text: inline.text,
            font,
            break: "never"
          });
          sources.push(
            this.createSourceFragment(
              inline.text,
              {
                font,
                code: true,
                ...(state.mark ? { mark: true } : {}),
                ...(state.color ? { color: state.color } : {}),
                ...(state.backgroundColor ? { backgroundColor: state.backgroundColor } : {}),
                ...(state.verticalAlign
                  ? {
                      baselineShift:
                        typography.fontSize *
                        (state.verticalAlign === "sup" ? -0.28 : 0.18)
                    }
                  : {})
              },
              0
            )
          );
          break;
        }
        case "line-break":
          breakLine();
          break;
        case "image":
          {
            const effectiveFontSize = typography.fontSize * (state.fontScale ?? 1)
            const height = inline.height ?? Math.max(14, effectiveFontSize * 1.05)
            const width = inline.width ?? height
            const font = this.buildFont(typography.fontFamily, effectiveFontSize, state)
            items.push({
              text: "\uFFFC",
              font,
              break: "never",
              extraWidth: Math.max(0, width - effectiveFontSize * 0.56)
            })
            sources.push(
              this.createSourceFragment(
                "",
                {
                  font,
                  image: {
                    src: inline.src,
                    ...(inline.alt ? { alt: inline.alt } : {}),
                    ...(inline.title ? { title: inline.title } : {}),
                    width,
                    height
                  }
                },
                0
              )
            )
          }
          break;
        default:
          break;
      }
    }
  }

  private buildFont(fontFamily: string, fontSize: number, state: InlineStyleState): string {
    const style = state.fontStyle ?? "normal";
    const weight = state.fontWeight ?? "400";
    return `${style} ${weight} ${fontSize}px ${fontFamily}`;
  }

  private getBlockCacheKey(block: TextBlock | HeadingBlock, input: LayoutInput): string {
    const kindSuffix = block.kind === "heading" ? `:h${block.level}` : ":p";
    return [
      block.id,
      kindSuffix,
      input.fontFamily,
      input.typography.fontSize,
      input.typography.lineHeight,
      block.style?.fontSize ?? "",
      block.style?.lineHeight ?? "",
      block.style?.fontStyle ?? "",
      block.style?.fontWeight ?? "",
      block.style?.textAlign ?? "",
      block.style?.color ?? "",
      block.style?.backgroundColor ?? "",
      block.style?.paddingLeft ?? "",
      block.style?.paddingRight ?? "",
      block.style?.paddingTop ?? "",
      block.style?.paddingBottom ?? ""
    ].join("|");
  }

  private containsUnsupportedInline(inlines: InlineNode[]): boolean {
    for (const inline of inlines) {
      switch (inline.kind) {
        case "image":
          break;
        case "line-break":
          break;
        case "emphasis":
        case "span":
        case "sub":
        case "sup":
        case "small":
        case "mark":
        case "del":
        case "ins":
        case "strong":
        case "link":
          if (this.containsUnsupportedInline(inline.children)) {
            return true;
          }
          break;
        default:
          break;
      }
    }

    return false;
  }

  private estimatePretextHeight(
    lineCount: number,
    lineHeight: number,
    kind: "text" | "heading"
  ): number {
    const bottomGap = kind === "heading" ? lineHeight * 0.45 : lineHeight * 0.55;
    return Math.max(lineHeight, lineCount * lineHeight + bottomGap);
  }

  private estimateNativeBlockHeight(block: BlockNode, input: LayoutInput): number {
    const typography = input.typography;
    const baseLineHeight = typography.fontSize * typography.lineHeight;

    switch (block.kind) {
      case "image": {
        return resolveImageLayout({
          availableWidth: Math.max(1, Math.floor(input.viewportWidth) - 16),
          viewportHeight: input.viewportHeight,
          ...(block.width ? { intrinsicWidth: block.width } : {}),
          ...(block.height ? { intrinsicHeight: block.height } : {})
        }).blockHeight;
      }
      case "code": {
        const codeFontSize = Math.max(13, typography.fontSize - 1)
        const codeFont = `400 ${codeFontSize}px "SFMono-Regular", Consolas, monospace"`
        const codeWidth = Math.max(
          40,
          Math.floor(input.viewportWidth) -
            16 -
            24 -
            (block.style?.paddingLeft ?? 0) -
            (block.style?.paddingRight ?? 0)
        )
        const codeLineHeight = Math.max(codeFontSize * 1.45, 18)
        const lineCount = Math.max(
          1,
          countWrappedPreformattedLines(block.text, codeWidth, codeFont)
        )
        return (
          lineCount * codeLineHeight +
          24 +
          (block.style?.paddingTop ?? 0) +
          (block.style?.paddingBottom ?? 0)
        );
      }
      case "quote":
        return Math.max(
          baseLineHeight * 2,
          estimateWrappedTextHeight(
            extractBlockText(block),
            Math.max(40, Math.floor(input.viewportWidth) - 16 - 18),
            `400 ${typography.fontSize}px "Iowan Old Style", "Palatino Linotype", serif`,
            baseLineHeight
          ) + 24
        );
      case "list":
        return Math.max(baseLineHeight * 2, estimateListBlockHeight(block, input.viewportWidth, typography));
      case "table":
        return Math.max(baseLineHeight * 3, estimateTableBlockHeight(block, input.viewportWidth, typography));
      case "figure":
        return Math.max(baseLineHeight * 3, estimateFigureBlockHeight(block, input.viewportWidth, input.viewportHeight, typography));
      case "aside":
      case "nav":
        return Math.max(
          baseLineHeight * 2,
          estimateWrappedTextHeight(
            extractBlockText(block),
            Math.max(40, Math.floor(input.viewportWidth) - 16),
            `400 ${typography.fontSize}px "Iowan Old Style", "Palatino Linotype", serif`,
            baseLineHeight
          ) + 20
        );
      case "definition-list":
        return Math.max(
          baseLineHeight * 2,
          estimateWrappedTextHeight(
            extractBlockText(block),
            Math.max(40, Math.floor(input.viewportWidth) - 16),
            `400 ${typography.fontSize}px "Iowan Old Style", "Palatino Linotype", serif`,
            baseLineHeight
          ) + 20
        );
      case "thematic-break":
        return 28;
      case "heading":
      case "text":
      default:
        return baseLineHeight * 1.5;
    }
  }

  private createSourceFragment(
    text: string,
    options: {
      font: string;
      color?: string;
      backgroundColor?: string;
      href?: string;
      title?: string;
      image?: {
        src: string;
        alt?: string;
        title?: string;
        width: number;
        height: number;
      };
      code?: boolean;
      mark?: boolean;
      baselineShift?: number;
    },
    gapBefore: number
  ): LayoutInlineFragment {
    return {
      text,
      font: options.font,
      gapBefore,
      ...(options.color ? { color: options.color } : {}),
      ...(options.backgroundColor ? { backgroundColor: options.backgroundColor } : {}),
      ...(options.image ? { image: options.image } : {}),
      ...(options.href ? { href: options.href } : {}),
      ...(options.title ? { title: options.title } : {}),
      ...(options.code ? { code: true } : {}),
      ...(options.mark ? { mark: true } : {}),
      ...(typeof options.baselineShift === "number"
        ? { baselineShift: options.baselineShift }
        : {})
    };
  }
}

function sourceToFragmentOptions(source: RichInlineSource | undefined): {
  font: string;
  color?: string;
  backgroundColor?: string;
  href?: string;
  title?: string;
  image?: {
    src: string;
    alt?: string;
    title?: string;
    width: number;
    height: number;
  };
  code?: boolean;
  mark?: boolean;
  baselineShift?: number;
} {
  if (!source) {
    return {
      font: `400 16px ${DEFAULT_FONT_FAMILY}`
    };
  }

  return {
    font: source.font,
    ...(source.color ? { color: source.color } : {}),
    ...(source.backgroundColor ? { backgroundColor: source.backgroundColor } : {}),
    ...(source.image ? { image: source.image } : {}),
    ...(source.href ? { href: source.href } : {}),
    ...(source.title ? { title: source.title } : {}),
    ...(source.code ? { code: true } : {}),
    ...(source.mark ? { mark: true } : {}),
    ...(typeof source.baselineShift === "number"
      ? { baselineShift: source.baselineShift }
      : {})
  };
}

function estimateListBlockHeight(
  block: ListBlock,
  viewportWidth: number,
  typography: TypographyOptions
): number {
  const font = `400 ${typography.fontSize}px "Iowan Old Style", "Palatino Linotype", serif`
  const lineHeight = Math.max(typography.fontSize * 1.45, 18)
  const contentWidth = Math.max(40, Math.floor(viewportWidth) - 16)
  const estimateRecursive = (list: ListBlock, depth: number): number => {
    let total = 0
    for (const item of list.items) {
      const textBlocks = item.blocks.filter((child) => child.kind !== "list")
      const itemText = textBlocks.map(extractBlockText).filter(Boolean).join(" ")
      const textWidth = Math.max(40, contentWidth - depth * 18 - 18)
      total += estimateWrappedTextHeight(itemText || " ", textWidth, font, lineHeight) + 6
      for (const child of item.blocks) {
        if (child.kind === "list") {
          total += estimateRecursive(child, depth + 1)
        }
      }
    }
    return total
  }

  return estimateRecursive(block, 0) + 8
}

function estimateTableBlockHeight(
  block: TableBlock,
  viewportWidth: number,
  typography: TypographyOptions
): number {
  const contentWidth = Math.max(40, Math.floor(viewportWidth) - 16)
  const captionFont = `italic 400 ${Math.max(14, typography.fontSize - 1)}px "Iowan Old Style", "Palatino Linotype", serif`
  const cellFont = `400 ${typography.fontSize}px "Iowan Old Style", "Palatino Linotype", serif`
  const headerFont = `700 ${typography.fontSize}px "Iowan Old Style", "Palatino Linotype", serif`
  const lineHeight = Math.max(typography.fontSize * 1.45, 18)
  const padding = 8
  let total = 8

  if (block.caption?.length) {
    total += estimateWrappedTextHeight(
      block.caption.map(extractBlockText).filter(Boolean).join(" "),
      contentWidth,
      captionFont,
      lineHeight
    ) + 8
  }

  const columnCount = Math.max(
    1,
    ...block.rows.map((row) => row.cells.reduce((sum, cell) => sum + (cell.colSpan ?? 1), 0))
  )
  const columnWidth = contentWidth / columnCount
  for (const row of block.rows) {
    let rowHeight = lineHeight + padding * 2
    for (const cell of row.cells) {
      const font = cell.header ? headerFont : cellFont
      const cellWidth = Math.max(32, columnWidth * Math.max(1, cell.colSpan ?? 1) - padding * 2)
      const text = cell.blocks.map(extractBlockText).filter(Boolean).join(" ")
      rowHeight = Math.max(
        rowHeight,
        estimateWrappedTextHeight(text || " ", cellWidth, font, lineHeight) + padding * 2
      )
    }
    total += rowHeight
  }

  return total + 8
}

function estimateFigureBlockHeight(
  block: FigureBlock,
  viewportWidth: number,
  viewportHeight: number,
  typography: TypographyOptions
): number {
  const contentWidth = Math.max(40, Math.floor(viewportWidth) - 16)
  const bodyFont = `400 ${typography.fontSize}px "Iowan Old Style", "Palatino Linotype", serif`
  const captionFont = `italic 400 ${Math.max(14, typography.fontSize - 1)}px "Iowan Old Style", "Palatino Linotype", serif`
  const lineHeight = Math.max(typography.fontSize * 1.45, 18)
  let total = 12

  for (const child of block.blocks) {
    if (child.kind === "image") {
      total +=
        resolveImageLayout({
          availableWidth: contentWidth,
          viewportHeight,
          ...(child.width ? { intrinsicWidth: child.width } : {}),
          ...(child.height ? { intrinsicHeight: child.height } : {})
        }).height + 10
      continue
    }

    const text = extractBlockText(child)
    if (text) {
      total += estimateWrappedTextHeight(text, contentWidth, bodyFont, lineHeight) + 8
    }
  }

  if (block.caption?.length) {
    total += estimateWrappedTextHeight(
      block.caption.map(extractBlockText).filter(Boolean).join(" "),
      Math.max(40, contentWidth - 24),
      captionFont,
      Math.max((typography.fontSize - 1) * 1.45, 18)
    )
  }

  return total + 10
}
