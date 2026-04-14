export type ReadingMode = "scroll" | "paginated";

export type BookMetadata = {
  title: string;
  language?: string;
  identifier?: string;
  creator?: string;
  publisher?: string;
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
};

export type BlockStyle = TextStyle & {
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
};

export type InlineNode =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "emphasis";
      children: InlineNode[];
    }
  | {
      kind: "strong";
      children: InlineNode[];
    }
  | {
      kind: "code";
      text: string;
    }
  | {
      kind: "link";
      href: string;
      children: InlineNode[];
      title?: string;
    }
  | {
      kind: "image";
      src: string;
      alt?: string;
      title?: string;
    }
  | {
      kind: "line-break";
    };

export type BaseBlock = {
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
  | ThematicBreakBlock;

export type SectionDocument = {
  id: string;
  href: string;
  title?: string;
  lang?: string;
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
  inlineOffset?: number;
  cfi?: string;
  progressInSection?: number;
};

export type SearchResult = {
  locator: Locator;
  excerpt: string;
  sectionId: string;
  href: string;
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
  mode?: ReadingMode;
  theme?: Partial<Theme>;
  typography?: Partial<TypographyOptions>;
};
