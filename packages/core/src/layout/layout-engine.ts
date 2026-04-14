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
  HeadingBlock,
  InlineNode,
  Locator,
  ReadingMode,
  SectionDocument,
  TextAlign,
  TextBlock,
  TypographyOptions
} from "../model/types";

export type LayoutInlineFragment = {
  text: string;
  font: string;
  gapBefore: number;
  href?: string;
  title?: string;
  code?: boolean;
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
  italic?: boolean;
  strong?: boolean;
  href?: string;
  title?: string;
  code?: boolean;
};

type RichInlineSource = LayoutInlineFragment;

type CompiledBlock = {
  prepared: PreparedRichInline;
  sources: RichInlineSource[];
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
        estimatedHeight: this.estimateNativeBlockHeight(block, input.typography)
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

    const lines: LayoutTextLine[] = [];
    walkRichInlineLineRanges(compiled.prepared, width, (range: RichInlineLineRange) => {
      const materialized = materializeRichInlineLineRange(compiled.prepared, range);
      lines.push(this.materializeLine(compiled.sources, materialized));
    });

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
        lines,
        estimatedHeight: this.estimatePretextHeight(lines.length, compiled.lineHeight, block.kind)
      };
    }

    return {
      type: "pretext",
      id: block.id,
      kind: block.kind,
      lineHeight: compiled.lineHeight,
      textAlign: compiled.textAlign,
      lines,
      estimatedHeight: this.estimatePretextHeight(lines.length, compiled.lineHeight, block.kind)
    };
  }

  private materializeLine(
    sources: RichInlineSource[],
    line: RichInlineLine
  ): LayoutTextLine {
    return {
      width: line.width,
      fragments: line.fragments.map((fragment) =>
        this.createSourceFragment(
          fragment.text,
          sourceToFragmentOptions(sources[fragment.itemIndex]),
          fragment.gapBefore
        )
      )
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
        ? input.typography.fontSize * HEADING_SCALE[block.level]
        : input.typography.fontSize;
    const lineHeight =
      block.kind === "heading"
        ? Math.max(baseFontSize * 1.25, input.typography.fontSize * input.typography.lineHeight)
        : input.typography.fontSize * input.typography.lineHeight;

    const items: RichInlineItem[] = [];
    const sources: RichInlineSource[] = [];
    this.collectRichInlineItems(
      block.inlines,
      {
        fontFamily: input.fontFamily,
        fontSize: baseFontSize
      },
      {},
      items,
      sources
    );

    if (items.length === 0) {
      return {
        prepared: prepareRichInline([{ text: "", font: this.buildFont(input.fontFamily, baseFontSize, {}) }]),
        sources: [
          this.createSourceFragment("", { font: this.buildFont(input.fontFamily, baseFontSize, {}) }, 0)
        ],
        lineHeight,
        textAlign: block.style?.textAlign ?? "start"
      };
    }

    const compiled = {
      prepared: prepareRichInline(items),
      sources,
      lineHeight,
      textAlign: block.style?.textAlign ?? "start"
    } satisfies CompiledBlock;

    this.compiledBlocks.set(key, compiled);
    return compiled;
  }

  private collectRichInlineItems(
    inlines: InlineNode[],
    typography: {
      fontFamily: string;
      fontSize: number;
    },
    state: InlineStyleState,
    items: RichInlineItem[],
    sources: RichInlineSource[]
  ): void {
    for (const inline of inlines) {
      switch (inline.kind) {
        case "text": {
          if (!inline.text) {
            continue;
          }

          const font = this.buildFont(typography.fontFamily, typography.fontSize, state);
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
                ...(state.code ? { code: true } : {})
              },
              0
            )
          );
          break;
        }
        case "emphasis":
          this.collectRichInlineItems(
            inline.children,
            typography,
            { ...state, italic: true },
            items,
            sources
          );
          break;
        case "strong":
          this.collectRichInlineItems(
            inline.children,
            typography,
            { ...state, strong: true },
            items,
            sources
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
            sources
          );
          break;
        case "code": {
          const font = this.buildFont('"SFMono-Regular", "SF Mono", Consolas, monospace', typography.fontSize * 0.94, {
            ...state,
            code: true
          });
          items.push({
            text: inline.text,
            font,
            break: "never"
          });
          sources.push(this.createSourceFragment(inline.text, { font, code: true }, 0));
          break;
        }
        case "line-break":
        case "image":
          break;
        default:
          break;
      }
    }
  }

  private buildFont(fontFamily: string, fontSize: number, state: InlineStyleState): string {
    const style = state.italic ? "italic" : "normal";
    const weight = state.strong ? "700" : "400";
    return `${style} ${weight} ${fontSize}px ${fontFamily}`;
  }

  private getBlockCacheKey(block: TextBlock | HeadingBlock, input: LayoutInput): string {
    const kindSuffix = block.kind === "heading" ? `:h${block.level}` : ":p";
    return [
      block.id,
      kindSuffix,
      input.fontFamily,
      input.typography.fontSize,
      input.typography.lineHeight
    ].join("|");
  }

  private containsUnsupportedInline(inlines: InlineNode[]): boolean {
    for (const inline of inlines) {
      switch (inline.kind) {
        case "image":
        case "line-break":
          return true;
        case "emphasis":
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

  private estimateNativeBlockHeight(block: BlockNode, typography: TypographyOptions): number {
    const baseLineHeight = typography.fontSize * typography.lineHeight;

    switch (block.kind) {
      case "image": {
        const naturalRatio =
          block.width && block.height && block.width > 0 && block.height > 0
            ? block.height / block.width
            : 0.66;
        const renderedWidth = Math.min(680, 42 * typography.fontSize);
        return Math.min(720, renderedWidth * naturalRatio + 32);
      }
      case "code": {
        const lineCount = Math.max(1, block.text.split("\n").length);
        return lineCount * baseLineHeight + 32;
      }
      case "quote":
        return Math.max(
          baseLineHeight * 2,
          block.blocks.length * baseLineHeight * 1.2 + 24
        );
      case "list":
        return Math.max(
          baseLineHeight * 2,
          block.items.length * baseLineHeight * 1.25 + 16
        );
      case "table":
        return Math.max(baseLineHeight * 3, block.rows.length * baseLineHeight * 1.4 + 24);
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
      href?: string;
      title?: string;
      code?: boolean;
    },
    gapBefore: number
  ): LayoutInlineFragment {
    return {
      text,
      font: options.font,
      gapBefore,
      ...(options.href ? { href: options.href } : {}),
      ...(options.title ? { title: options.title } : {}),
      ...(options.code ? { code: true } : {})
    };
  }
}

function sourceToFragmentOptions(source: RichInlineSource | undefined): {
  font: string;
  href?: string;
  title?: string;
  code?: boolean;
} {
  if (!source) {
    return {
      font: `400 16px ${DEFAULT_FONT_FAMILY}`
    };
  }

  return {
    font: source.font,
    ...(source.href ? { href: source.href } : {}),
    ...(source.title ? { title: source.title } : {}),
    ...(source.code ? { code: true } : {})
  };
}
