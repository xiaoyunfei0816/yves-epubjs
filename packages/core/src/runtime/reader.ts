import EventEmitter from "eventemitter3";
import { getMimeTypeFromPath } from "../container/resource-mime";
import { LayoutEngine, type LayoutBlock, type LayoutPretextBlock } from "../layout/layout-engine";
import { BookParser } from "../parser/book-parser";
import {
  normalizeEpubInput,
  type EpubInput
} from "../container/normalize-input";
import type {
  BlockNode,
  Book,
  InlineNode,
  Locator,
  ReaderEvent,
  ReaderEventMap,
  ReaderOptions,
  SectionDocument,
  SearchResult,
  Theme,
  TypographyOptions
} from "../model/types";

type PageBlockSlice =
  | {
      type: "pretext";
      block: LayoutPretextBlock;
      lineStart: number;
      lineEnd: number;
    }
  | {
      type: "native";
      block: BlockNode;
    };

type ReaderPage = {
  pageNumber: number;
  spineIndex: number;
  sectionId: string;
  sectionHref: string;
  blocks: PageBlockSlice[];
};

export type PaginationInfo = {
  currentPage: number;
  totalPages: number;
};

const DEFAULT_THEME: Theme = {
  color: "#1f2328",
  background: "#fffdf7"
};

const DEFAULT_TYPOGRAPHY: TypographyOptions = {
  fontSize: 18,
  lineHeight: 1.6,
  paragraphSpacing: 12
};

export class EpubReader {
  private readonly parser = new BookParser();
  private readonly events = new EventEmitter<ReaderEventMap>();
  private readonly layoutEngine = new LayoutEngine();

  private book: Book | null = null;
  private resources: {
    readBinary(path: string): Promise<Uint8Array>;
  } | null = null;
  private locator: Locator | null = null;
  private mode: "scroll" | "paginated";
  private theme: Theme;
  private typography: TypographyOptions;
  private currentSectionIndex = 0;
  private readonly objectUrls = new Map<string, string>();
  private resizeObserver: ResizeObserver | null = null;
  private lastMeasuredWidth = 0;
  private pages: ReaderPage[] = [];
  private currentPageNumber = 1;

  constructor(private readonly options: ReaderOptions = {}) {
    this.mode = options.mode ?? "scroll";
    this.theme = { ...DEFAULT_THEME, ...options.theme };
    this.typography = { ...DEFAULT_TYPOGRAPHY, ...options.typography };
    this.attachResizeObserver();
  }

  async open(input: EpubInput): Promise<Book> {
    const normalized = await normalizeEpubInput(input);
    const parserInput = {
      data: normalized.data
    } as {
      data: Uint8Array;
      sourceName?: string;
    };

    if (normalized.sourceName) {
      parserInput.sourceName = normalized.sourceName;
    }

    const parsed = await this.parser.parseDetailed(parserInput);
    this.book = parsed.book;
    this.resources = parsed.resources;
    this.revokeObjectUrls();
    this.pages = [];
    this.currentPageNumber = 1;
    this.events.emit("opened", { book: this.book });
    return this.book;
  }

  async render(): Promise<void> {
    await this.waitForFonts();
    this.renderCurrentSection();

    this.events.emit("rendered", { mode: this.mode });
  }

  async next(): Promise<void> {
    if (!this.book) {
      return;
    }

    if (this.mode === "paginated") {
      const nextPage = Math.min(this.currentPageNumber + 1, this.pages.length || 1);
      await this.goToPage(nextPage);
      return;
    }

    const lastIndex = Math.max(this.book.sections.length - 1, 0);
    this.currentSectionIndex = Math.min(this.currentSectionIndex + 1, lastIndex);
    await this.goToLocation({ spineIndex: this.currentSectionIndex, progressInSection: 0 });
  }

  async prev(): Promise<void> {
    if (!this.book) {
      return;
    }

    if (this.mode === "paginated") {
      const previousPage = Math.max(this.currentPageNumber - 1, 1);
      await this.goToPage(previousPage);
      return;
    }

    this.currentSectionIndex = Math.max(this.currentSectionIndex - 1, 0);
    await this.goToLocation({ spineIndex: this.currentSectionIndex, progressInSection: 0 });
  }

  async goToLocation(locator: Locator): Promise<void> {
    if (!this.book) {
      return;
    }

    const nextIndex = Math.max(
      0,
      Math.min(locator.spineIndex, this.book.sections.length - 1)
    );

    this.currentSectionIndex = nextIndex;
    this.locator = locator;
    this.renderCurrentSection();
    this.events.emit("relocated", { locator: this.locator });
  }

  async goToTocItem(id: string): Promise<void> {
    if (!this.book) {
      return;
    }

    const tocItem = this.findTocItem(this.book.toc, id);
    if (!tocItem) {
      return;
    }

    const targetIndex = this.book.spine.findIndex((item) =>
      tocItem.href.startsWith(item.href)
    );

    if (targetIndex >= 0) {
      await this.goToLocation({ spineIndex: targetIndex, progressInSection: 0 });
    }
  }

  async setTheme(theme: Partial<Theme>): Promise<void> {
    this.theme = { ...this.theme, ...theme };
    this.applyContainerTheme();
    await this.waitForFonts();
    this.pages = [];
    this.renderCurrentSection();
    this.events.emit("themeChanged", { theme: this.theme });
  }

  async setTypography(options: Partial<TypographyOptions>): Promise<void> {
    this.typography = { ...this.typography, ...options };
    await this.waitForFonts();
    this.pages = [];
    this.renderCurrentSection();
    this.events.emit("typographyChanged", { typography: this.typography });
  }

  async setMode(mode: "scroll" | "paginated"): Promise<void> {
    this.mode = mode;
    await this.waitForFonts();
    this.pages = [];
    this.renderCurrentSection();
    this.events.emit("rendered", { mode: this.mode });
  }

  async goToPage(pageNumber: number): Promise<void> {
    if (!this.book) {
      return;
    }

    this.ensurePages();
    if (this.pages.length === 0) {
      return;
    }

    const nextPage = this.pages[Math.max(0, Math.min(pageNumber - 1, this.pages.length - 1))];
    if (!nextPage) {
      return;
    }

    this.currentSectionIndex = nextPage.spineIndex;
    this.currentPageNumber = nextPage.pageNumber;
    this.locator = {
      spineIndex: nextPage.spineIndex,
      progressInSection:
        this.pages.filter((page) => page.spineIndex === nextPage.spineIndex).length > 1
          ? nextPage.blocks.length / Math.max(nextPage.blocks.length, 1)
          : 0
    };
    this.renderCurrentSection();
    this.events.emit("relocated", { locator: this.locator });
  }

  async search(query: string): Promise<SearchResult[]> {
    if (!this.book || !query.trim()) {
      return [];
    }

    const normalizedQuery = query.trim().toLowerCase();
    const results: SearchResult[] = [];

    for (let index = 0; index < this.book.sections.length; index += 1) {
      const section = this.book.sections[index];
      if (!section) {
        continue;
      }

      for (const block of section.blocks) {
        const text = this.extractBlockText(block).trim();
        if (!text.toLowerCase().includes(normalizedQuery)) {
          continue;
        }

        results.push({
          sectionId: section.id,
          href: section.href,
          excerpt: text,
          locator: {
            spineIndex: index,
            blockId: block.id,
            progressInSection: 0
          }
        });
      }
    }

    this.events.emit("searchCompleted", { query, results });
    return results;
  }

  getCurrentLocation(): Locator | null {
    return this.locator;
  }

  on<TEvent extends ReaderEvent>(
    event: TEvent,
    handler: (payload: ReaderEventMap[TEvent]) => void
  ): () => void {
    const wrapped = ((payload: ReaderEventMap[TEvent]) => {
      handler(payload);
    }) as never;

    this.events.on(event, wrapped);
    return () => this.events.off(event, wrapped);
  }

  destroy(): void {
    this.events.removeAllListeners();
    this.book = null;
    this.resources = null;
    this.locator = null;
    this.pages = [];
    this.currentPageNumber = 1;
    this.revokeObjectUrls();
    if (this.options.container) {
      this.options.container.innerHTML = "";
      this.options.container.removeAttribute("style");
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  getBook(): Book | null {
    return this.book;
  }

  getTheme(): Theme {
    return this.theme;
  }

  getTypography(): TypographyOptions {
    return this.typography;
  }

  getPaginationInfo(): PaginationInfo {
    this.ensurePages();
    return {
      currentPage: Math.max(1, Math.min(this.currentPageNumber, this.pages.length || 1)),
      totalPages: Math.max(1, this.pages.length)
    };
  }

  private findTocItem(items: Book["toc"], id: string): Book["toc"][number] | null {
    for (const item of items) {
      if (item.id === id) {
        return item;
      }

      const nested = this.findTocItem(item.children, id);
      if (nested) {
        return nested;
      }
    }

    return null;
  }

  private renderCurrentSection(): void {
    if (!this.book || !this.options.container) {
      return;
    }

    const section = this.book.sections[this.currentSectionIndex];
    if (!section) {
      return;
    }

    this.applyContainerTheme();
    const layout = this.layoutEngine.layout(
      {
        section,
        spineIndex: this.currentSectionIndex,
        viewportWidth: this.getContentWidth(),
        viewportHeight: this.options.container.clientHeight,
        typography: this.typography,
        fontFamily: this.getFontFamily()
      },
      this.mode
    );
    this.lastMeasuredWidth = layout.width;
    this.options.container.dataset.mode = this.mode;
    if (this.mode === "paginated") {
      this.ensurePages(layout);
      const currentPage = this.findCurrentPageForSection(section.id);
      this.options.container.innerHTML = this.renderPage(section, currentPage ?? null);
      if (currentPage) {
        this.currentPageNumber = currentPage.pageNumber;
      }
    } else {
      this.options.container.innerHTML = this.renderSection(section, layout.blocks);
      this.syncCurrentPageFromSection();
    }
    this.locator = {
      spineIndex: this.currentSectionIndex,
      progressInSection: 0
    };
  }

  private applyContainerTheme(): void {
    if (!this.options.container) {
      return;
    }

    this.options.container.style.background = this.theme.background;
    this.options.container.style.color = this.theme.color;
    this.options.container.style.fontSize = `${this.typography.fontSize}px`;
    this.options.container.style.lineHeight = String(this.typography.lineHeight);
  }

  private renderSection(section: SectionDocument, blocks: LayoutBlock[]): string {
    const title = section.title
      ? `<header class="epub-section-header"><h2>${this.escapeHtml(section.title)}</h2></header>`
      : "";

    return `<article class="epub-section" data-section-id="${section.id}" data-href="${section.href}">${title}${blocks
      .map((block) => this.renderLayoutBlock(block))
      .join("")}</article>`;
  }

  private renderPage(section: SectionDocument, page: ReaderPage | null): string {
    const title = section.title
      ? `<header class="epub-section-header"><h2>${this.escapeHtml(section.title)}</h2></header>`
      : "";
    const pageLabel = page
      ? `<div class="epub-page-label">Page ${page.pageNumber} / ${Math.max(1, this.pages.length)}</div>`
      : "";
    const blocks = page
      ? page.blocks.map((slice) => this.renderPageBlockSlice(slice)).join("")
      : `<p class="empty-state">No page content available.</p>`;

    return `<article class="epub-section epub-section-paginated" data-section-id="${section.id}" data-href="${section.href}">${pageLabel}${title}${blocks}</article>`;
  }

  private renderPageBlockSlice(slice: PageBlockSlice): string {
    if (slice.type === "native") {
      return this.renderBlock(slice.block);
    }

    return this.renderPretextBlock(slice.block, slice.lineStart, slice.lineEnd);
  }

  private renderLayoutBlock(block: LayoutBlock): string {
    if (block.type === "pretext") {
      return this.renderPretextBlock(block);
    }

    return this.renderBlock(block.block);
  }

  private renderPretextBlock(
    block: LayoutPretextBlock,
    lineStart = 0,
    lineEnd = block.lines.length
  ): string {
    const tagName = block.kind === "heading" ? `h${block.level}` : "div";
    const wrapperClass =
      block.kind === "heading" ? `epub-pretext-block epub-pretext-heading level-${block.level}` : "epub-pretext-block";
    const visibleLines = block.lines.slice(lineStart, lineEnd);

    return `<${tagName} class="${wrapperClass}" data-block-id="${block.id}" style="--pretext-line-height:${block.lineHeight}px; text-align:${this.renderTextAlign(
      block.textAlign
    )};">${visibleLines
      .map(
        (line) =>
          `<span class="epub-pretext-line" style="min-height:${lineHeightToCss(
            block.lineHeight
          )}; justify-content:${this.renderLineAlignment(block.textAlign)}">${line.fragments
            .map((fragment) => this.renderPretextFragment(fragment))
            .join("")}</span>`
      )
      .join("")}</${tagName}>`;
  }

  private renderPretextFragment(fragment: LayoutPretextBlock["lines"][number]["fragments"][number]): string {
    const gapStyle = fragment.gapBefore > 0 ? ` margin-left:${fragment.gapBefore}px;` : "";
    const className = fragment.code ? "epub-pretext-fragment code-fragment" : "epub-pretext-fragment";
    const body = `<span class="${className}" style="font:${this.escapeHtml(fragment.font)};${gapStyle}">${this.escapeHtml(
      fragment.text
    )}</span>`;

    if (fragment.href) {
      return `<a href="${this.escapeHtml(fragment.href)}" title="${this.escapeHtml(
        fragment.title ?? ""
      )}" class="epub-pretext-link">${body}</a>`;
    }

    return body;
  }

  private renderBlock(block: BlockNode): string {
    switch (block.kind) {
      case "heading":
        return `<h${block.level} data-block-id="${block.id}">${this.renderInlines(block.inlines)}</h${block.level}>`;
      case "text":
        return `<p data-block-id="${block.id}">${this.renderInlines(block.inlines)}</p>`;
      case "quote":
        return `<blockquote data-block-id="${block.id}">${block.blocks
          .map((child) => this.renderBlock(child))
          .join("")}</blockquote>`;
      case "code":
        return `<pre data-block-id="${block.id}"><code>${this.escapeHtml(
          block.text
        )}</code></pre>`;
      case "image":
        return `<figure data-block-id="${block.id}"><img class="epub-image" src="${this.escapeHtml(
          this.resolveRenderableResourceUrl(block.src)
        )}" alt="${this.escapeHtml(block.alt ?? "")}"${this.renderImageDimensions(
          block.width,
          block.height
        )} data-fullsize-src="${this.escapeHtml(
          this.resolveRenderableResourceUrl(block.src)
        )}" /></figure>`;
      case "list":
        return block.ordered
          ? `<ol data-block-id="${block.id}"${
              block.start ? ` start="${block.start}"` : ""
            }>${block.items
              .map(
                (item) =>
                  `<li>${item.blocks.map((child) => this.renderBlock(child)).join("")}</li>`
              )
              .join("")}</ol>`
          : `<ul data-block-id="${block.id}">${block.items
              .map(
                (item) =>
                  `<li>${item.blocks.map((child) => this.renderBlock(child)).join("")}</li>`
              )
              .join("")}</ul>`;
      case "table":
        return `<table data-block-id="${block.id}">${block.rows
          .map(
            (row) =>
              `<tr>${row.cells
                .map((cell) => {
                  const tag = cell.header ? "th" : "td";
                  const attrs = `${cell.colSpan ? ` colspan="${cell.colSpan}"` : ""}${
                    cell.rowSpan ? ` rowspan="${cell.rowSpan}"` : ""
                  }`;
                  return `<${tag}${attrs}>${cell.blocks
                    .map((child) => this.renderBlock(child))
                    .join("")}</${tag}>`;
                })
                .join("")}</tr>`
          )
          .join("")}</table>`;
      case "thematic-break":
        return `<hr data-block-id="${block.id}" />`;
      default:
        return "";
    }
  }

  private renderInlines(inlines: InlineNode[]): string {
    return inlines
      .map((inline) => {
        switch (inline.kind) {
          case "text":
            return this.escapeHtml(inline.text);
          case "emphasis":
            return `<em>${this.renderInlines(inline.children)}</em>`;
          case "strong":
            return `<strong>${this.renderInlines(inline.children)}</strong>`;
          case "code":
            return `<code>${this.escapeHtml(inline.text)}</code>`;
          case "link":
            return `<a href="${this.escapeHtml(inline.href)}">${this.renderInlines(
              inline.children
            )}</a>`;
          case "image":
            return `<img class="inline-image" src="${this.escapeHtml(
              this.resolveRenderableResourceUrl(inline.src)
            )}" alt="${this.escapeHtml(inline.alt ?? "")}" />`;
          case "line-break":
            return "<br />";
          default:
            return "";
        }
      })
      .join("");
  }

  private extractBlockText(block: BlockNode): string {
    switch (block.kind) {
      case "heading":
      case "text":
        return this.extractInlineText(block.inlines);
      case "quote":
        return block.blocks.map((child) => this.extractBlockText(child)).join(" ");
      case "code":
        return block.text;
      case "image":
        return block.alt ?? "";
      case "list":
        return block.items
          .flatMap((item) => item.blocks.map((child) => this.extractBlockText(child)))
          .join(" ");
      case "table":
        return block.rows
          .flatMap((row) =>
            row.cells.flatMap((cell) =>
              cell.blocks.map((child) => this.extractBlockText(child))
            )
          )
          .join(" ");
      case "thematic-break":
        return "";
      default:
        return "";
    }
  }

  private extractInlineText(inlines: InlineNode[]): string {
    return inlines
      .map((inline) => {
        switch (inline.kind) {
          case "text":
            return inline.text;
          case "emphasis":
          case "strong":
          case "link":
            return this.extractInlineText(inline.children);
          case "code":
            return inline.text;
          case "image":
            return inline.alt ?? "";
          case "line-break":
            return "\n";
          default:
            return "";
        }
      })
      .join("");
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  private resolveRenderableResourceUrl(path: string): string {
    if (!this.resources || typeof Blob === "undefined" || typeof URL === "undefined") {
      return path;
    }

    const cached = this.objectUrls.get(path);
    if (cached) {
      return cached;
    }

    const mimeType = getMimeTypeFromPath(path) ?? "application/octet-stream";
    const placeholder = path;

    this.resources
      .readBinary(path)
      .then((binary) => {
        if (typeof URL.createObjectURL !== "function") {
          return;
        }

        const bytes = new Uint8Array(binary.byteLength);
        bytes.set(binary);
        const objectUrl = URL.createObjectURL(
          new Blob([bytes.buffer as ArrayBuffer], { type: mimeType })
        );
        const previous = this.objectUrls.get(path);
        if (previous && previous !== path && typeof URL.revokeObjectURL === "function") {
          URL.revokeObjectURL(previous);
        }
        this.objectUrls.set(path, objectUrl);
        this.renderCurrentSection();
      })
      .catch(() => {
        // Keep the original path when the resource cannot be resolved.
      });

    this.objectUrls.set(path, placeholder);
    return placeholder;
  }

  private revokeObjectUrls(): void {
    if (typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") {
      this.objectUrls.clear();
      return;
    }

    for (const value of this.objectUrls.values()) {
      if (value.startsWith("blob:")) {
        URL.revokeObjectURL(value);
      }
    }

    this.objectUrls.clear();
  }

  private renderImageDimensions(width?: number, height?: number): string {
    let attributes = "";

    if (typeof width === "number" && Number.isFinite(width) && width > 0) {
      attributes += ` width="${width}" data-epub-width="${width}"`;
    }

    if (typeof height === "number" && Number.isFinite(height) && height > 0) {
      attributes += ` height="${height}" data-epub-height="${height}"`;
    }

    return attributes;
  }

  private getContentWidth(): number {
    if (!this.options.container) {
      return 672;
    }

    const container = this.options.container;
    const computed =
      typeof window !== "undefined" && typeof window.getComputedStyle === "function"
        ? window.getComputedStyle(container)
        : null;
    const paddingLeft = computed ? Number.parseFloat(computed.paddingLeft) || 0 : 0;
    const paddingRight = computed ? Number.parseFloat(computed.paddingRight) || 0 : 0;
    const rootFontSize =
      typeof document !== "undefined"
        ? Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16
        : 16;
    const maxContentWidth = 42 * rootFontSize;
    const available = Math.max(120, container.clientWidth - paddingLeft - paddingRight);
    return Math.min(available, maxContentWidth);
  }

  private getFontFamily(): string {
    if (!this.options.container || typeof window === "undefined") {
      return '"Iowan Old Style", "Palatino Linotype", serif';
    }

    const fontFamily = window.getComputedStyle(this.options.container).fontFamily.trim();
    return fontFamily || '"Iowan Old Style", "Palatino Linotype", serif';
  }

  private attachResizeObserver(): void {
    if (!this.options.container || typeof ResizeObserver === "undefined") {
      return;
    }

    this.resizeObserver = new ResizeObserver(() => {
      if (!this.options.container || !this.book) {
        return;
      }

      const nextWidth = this.getContentWidth();
      if (Math.abs(nextWidth - this.lastMeasuredWidth) < 1) {
        return;
      }

      this.pages = [];
      this.renderCurrentSection();
    });

    this.resizeObserver.observe(this.options.container);
  }

  private async waitForFonts(): Promise<void> {
    if (typeof document === "undefined" || !("fonts" in document)) {
      return;
    }

    const fonts = document.fonts;
    if (!fonts || typeof fonts.ready === "undefined") {
      return;
    }

    await fonts.ready;
  }

  private renderTextAlign(textAlign: "start" | "center" | "end" | "justify"): string {
    switch (textAlign) {
      case "center":
        return "center";
      case "end":
        return "right";
      case "justify":
        return "justify";
      case "start":
      default:
        return "left";
    }
  }

  private renderLineAlignment(textAlign: "start" | "center" | "end" | "justify"): string {
    switch (textAlign) {
      case "center":
        return "center";
      case "end":
        return "flex-end";
      case "justify":
      case "start":
      default:
        return "flex-start";
    }
  }

  private ensurePages(sectionLayout?: ReturnType<LayoutEngine["layout"]>): void {
    if (!this.book || !this.options.container) {
      this.pages = [];
      return;
    }

    const targetWidth = this.getContentWidth();
    if (
      this.pages.length > 0 &&
      sectionLayout === undefined &&
      Math.abs(this.lastMeasuredWidth - targetWidth) < 1
    ) {
      return;
    }

    const pageHeight = this.getPageHeight();
    const pages: ReaderPage[] = [];
    let pageNumber = 1;

    for (let index = 0; index < this.book.sections.length; index += 1) {
      const section = this.book.sections[index];
      if (!section) {
        continue;
      }

      const layout =
        sectionLayout && index === this.currentSectionIndex
          ? sectionLayout
          : this.layoutEngine.layout(
              {
                section,
                spineIndex: index,
                viewportWidth: targetWidth,
                viewportHeight: this.options.container.clientHeight,
                typography: this.typography,
                fontFamily: this.getFontFamily()
              },
              "paginated"
            );

      let currentPage: ReaderPage = {
        pageNumber,
        spineIndex: index,
        sectionId: section.id,
        sectionHref: section.href,
        blocks: []
      };
      let usedHeight = 0;

      for (const layoutBlock of layout.blocks) {
        if (layoutBlock.type === "pretext") {
          let lineStart = 0;
          while (lineStart < layoutBlock.lines.length) {
            const remainingHeight = pageHeight - usedHeight;
            let lineCapacity = Math.max(1, Math.floor(remainingHeight / layoutBlock.lineHeight));
            if (lineCapacity <= 0 && currentPage.blocks.length > 0) {
              pages.push(currentPage);
              pageNumber += 1;
              currentPage = {
                pageNumber,
                spineIndex: index,
                sectionId: section.id,
                sectionHref: section.href,
                blocks: []
              };
              usedHeight = 0;
              lineCapacity = Math.max(1, Math.floor(pageHeight / layoutBlock.lineHeight));
            }

            const lineEnd = Math.min(layoutBlock.lines.length, lineStart + lineCapacity);
            currentPage.blocks.push({
              type: "pretext",
              block: layoutBlock,
              lineStart,
              lineEnd
            });
            usedHeight += (lineEnd - lineStart) * layoutBlock.lineHeight;
            lineStart = lineEnd;

            if (lineStart < layoutBlock.lines.length) {
              pages.push(currentPage);
              pageNumber += 1;
              currentPage = {
                pageNumber,
                spineIndex: index,
                sectionId: section.id,
                sectionHref: section.href,
                blocks: []
              };
              usedHeight = 0;
            }
          }

          usedHeight += layoutBlock.lineHeight * (layoutBlock.kind === "heading" ? 0.45 : 0.55);
          continue;
        }

        if (
          currentPage.blocks.length > 0 &&
          usedHeight + layoutBlock.estimatedHeight > pageHeight
        ) {
          pages.push(currentPage);
          pageNumber += 1;
          currentPage = {
            pageNumber,
            spineIndex: index,
            sectionId: section.id,
            sectionHref: section.href,
            blocks: []
          };
          usedHeight = 0;
        }

        currentPage.blocks.push({
          type: "native",
          block: layoutBlock.block
        });
        usedHeight += layoutBlock.estimatedHeight;
      }

      if (currentPage.blocks.length > 0 || pages.length === 0) {
        pages.push(currentPage);
        pageNumber += 1;
      }
    }

    this.pages = pages.map((page, index) => ({
      ...page,
      pageNumber: index + 1
    }));
  }

  private getPageHeight(): number {
    if (!this.options.container) {
      return 720;
    }

    return Math.max(220, this.options.container.clientHeight - 24);
  }

  private findCurrentPageForSection(sectionId: string): ReaderPage | null {
    const page =
      this.pages.find(
        (entry) =>
          entry.pageNumber === this.currentPageNumber && entry.sectionId === sectionId
      ) ??
      this.pages.find((entry) => entry.sectionId === sectionId) ??
      null;

    return page;
  }

  private syncCurrentPageFromSection(): void {
    const matchingPage = this.pages.find((page) => page.spineIndex === this.currentSectionIndex);
    this.currentPageNumber = matchingPage?.pageNumber ?? this.currentSectionIndex + 1;
  }
}

function lineHeightToCss(lineHeight: number): string {
  return `${Math.max(1, Number.parseFloat(lineHeight.toFixed(2)))}px`;
}
