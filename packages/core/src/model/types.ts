export type ReadingMode = "scroll" | "paginated";
export type RenderMode = "canvas" | "dom";
export type ChapterRenderReason = string;
export type ChapterRenderDecision = {
  mode: RenderMode;
  score: number;
  reasons: ChapterRenderReason[];
};

export type BookMetadata = {
  title: string;
  language?: string;
  identifier?: string;
  creator?: string;
  publisher?: string;
  coverImageHref?: string;
};

export type ManifestItem = {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
};

export type SpineItem = {
  idref: string;
  href: string;
  linear: boolean;
  mediaType?: string;
  properties?: string;
};

export type TocItem = {
  id: string;
  label: string;
  href: string;
  children: TocItem[];
};

export type TextAlign = "start" | "center" | "end" | "justify";

export type TextStyle = {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
  fontStyle?: "normal" | "italic";
  lineHeight?: number;
  color?: string;
  backgroundColor?: string;
  textAlign?: TextAlign;
  letterSpacing?: number;
  whiteSpace?: "normal" | "pre-wrap";
  wordBreak?: "normal" | "keep-all" | "break-word";
  width?: number;
  height?: number;
  verticalAlign?: "baseline" | "middle" | "sub" | "sup";
  marginLeft?: number;
  marginRight?: number;
};

export type NodeAttributes = {
  tagName?: string;
  className?: string;
  lang?: string;
  dir?: string;
};

export type BlockStyle = TextStyle & {
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
};

type InlineBase = NodeAttributes & {
  style?: TextStyle;
};

export type InlineNode =
  | (InlineBase & {
      kind: "text";
      text: string;
    })
  | (InlineBase & {
      kind: "span";
      children: InlineNode[];
    })
  | (InlineBase & {
      kind: "emphasis";
      children: InlineNode[];
    })
  | (InlineBase & {
      kind: "strong";
      children: InlineNode[];
    })
  | (InlineBase & {
      kind: "sub";
      children: InlineNode[];
    })
  | (InlineBase & {
      kind: "sup";
      children: InlineNode[];
    })
  | (InlineBase & {
      kind: "small";
      children: InlineNode[];
    })
  | (InlineBase & {
      kind: "mark";
      children: InlineNode[];
    })
  | (InlineBase & {
      kind: "del";
      children: InlineNode[];
    })
  | (InlineBase & {
      kind: "ins";
      children: InlineNode[];
    })
  | (InlineBase & {
      kind: "code";
      text: string;
    })
  | (InlineBase & {
      kind: "link";
      href: string;
      children: InlineNode[];
      title?: string;
    })
  | (InlineBase & {
      kind: "image";
      src: string;
      alt?: string;
      title?: string;
      width?: number;
      height?: number;
    })
  | (InlineBase & {
      kind: "line-break";
    });

export type BaseBlock = NodeAttributes & {
  id: string;
  kind: string;
  style?: BlockStyle;
};

export type TextBlock = BaseBlock & {
  kind: "text";
  inlines: InlineNode[];
};

export type HeadingBlock = BaseBlock & {
  kind: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
  inlines: InlineNode[];
};

export type ImageBlock = BaseBlock & {
  kind: "image";
  src: string;
  alt?: string;
  title?: string;
  width?: number;
  height?: number;
};

export type QuoteBlock = BaseBlock & {
  kind: "quote";
  blocks: BlockNode[];
  attribution?: string;
};

export type CodeBlock = BaseBlock & {
  kind: "code";
  text: string;
  language?: string;
};

export type ListItemBlock = {
  id: string;
  blocks: BlockNode[];
};

export type ListBlock = BaseBlock & {
  kind: "list";
  ordered: boolean;
  start?: number;
  items: ListItemBlock[];
};

export type TableCell = {
  id: string;
  blocks: BlockNode[];
  colSpan?: number;
  rowSpan?: number;
  header?: boolean;
};

export type TableRow = {
  id: string;
  cells: TableCell[];
};

export type TableBlock = BaseBlock & {
  kind: "table";
  rows: TableRow[];
  caption?: BlockNode[];
};

export type FigureBlock = BaseBlock & {
  kind: "figure";
  blocks: BlockNode[];
  caption?: BlockNode[];
};

export type AsideBlock = BaseBlock & {
  kind: "aside";
  blocks: BlockNode[];
};

export type NavBlock = BaseBlock & {
  kind: "nav";
  blocks: BlockNode[];
};

export type DefinitionListItem = {
  id: string;
  term: BlockNode[];
  descriptions: BlockNode[][];
};

export type DefinitionListBlock = BaseBlock & {
  kind: "definition-list";
  items: DefinitionListItem[];
};

export type ThematicBreakBlock = BaseBlock & {
  kind: "thematic-break";
};

export type BlockNode =
  | TextBlock
  | HeadingBlock
  | ImageBlock
  | QuoteBlock
  | CodeBlock
  | ListBlock
  | TableBlock
  | FigureBlock
  | AsideBlock
  | NavBlock
  | DefinitionListBlock
  | ThematicBreakBlock;

export type SectionDocument = {
  id: string;
  href: string;
  title?: string;
  lang?: string;
  presentationRole?: "cover" | "image-page";
  blocks: BlockNode[];
  anchors: Record<string, string>;
};

export type Book = {
  metadata: BookMetadata;
  manifest: ManifestItem[];
  spine: SpineItem[];
  toc: TocItem[];
  sections: SectionDocument[];
};

export type Theme = {
  color: string;
  background: string;
};

export type TypographyOptions = {
  fontSize: number;
  lineHeight: number;
  paragraphSpacing: number;
};

export type Locator = {
  spineIndex: number;
  blockId?: string;
  anchorId?: string;
  inlineOffset?: number;
  cfi?: string;
  progressInSection?: number;
};

export type SearchResult = {
  locator: Locator;
  excerpt: string;
  matchText?: string;
  sectionId: string;
  href: string;
};

export type Point = {
  x: number;
  y: number;
};

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type HitTestResult =
  | {
      kind: "link";
      rect: Rect;
      sectionId: string;
      blockId: string;
      href: string;
      locator: Locator | undefined;
      text: string | undefined;
    }
  | {
      kind: "image";
      rect: Rect;
      sectionId: string;
      blockId: string;
      src: string;
      alt: string | undefined;
      locator: Locator | undefined;
    }
  | {
      kind: "block";
      rect: Rect;
      sectionId: string;
      blockId: string;
      locator: Locator | undefined;
      text: string | undefined;
    };

export type VisibleDrawBounds = Rect[];

export type RenderMetrics = {
  backend: "canvas" | "dom";
  visibleSectionCount: number;
  visibleDrawOpCount: number;
  highlightedDrawOpCount: number;
  totalCanvasHeight: number;
};

export type RenderLayoutAuthority = "project-layout" | "browser-layout";

export type RenderGeometrySource = "interaction-map" | "dom-geometry";

export type RenderInteractionModel = "canvas-hit-test" | "dom-events";

export type RenderFlowModel = "scroll-slices" | "paginated-pages" | "dom-flow";

export type RenderDiagnostics = {
  mode: RenderMode;
  score: number;
  reasons: string[];
  sectionId?: string;
  sectionHref?: string;
  layoutAuthority?: RenderLayoutAuthority;
  geometrySource?: RenderGeometrySource;
  interactionModel?: RenderInteractionModel;
  flowModel?: RenderFlowModel;
  alignmentTarget?: "dom-baseline";
  styleProfile?: "shared";
};

export type VisibleSectionDiagnostics = RenderDiagnostics & {
  isCurrent: boolean;
};

export type ReaderEventMap = {
  opened: { book: Book };
  rendered: { mode: ReadingMode };
  relocated: { locator: Locator | null };
  themeChanged: { theme: Theme };
  typographyChanged: { typography: TypographyOptions };
  searchCompleted: { query: string; results: SearchResult[] };
};

export type ReaderEvent = keyof ReaderEventMap;

export type ReaderOptions = {
  container?: HTMLElement;
  canvas?: HTMLCanvasElement;
  mode?: ReadingMode;
  theme?: Partial<Theme>;
  typography?: Partial<TypographyOptions>;
};
