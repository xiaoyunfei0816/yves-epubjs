import EventEmitter from "eventemitter3";
import { getMimeTypeFromPath } from "../container/resource-mime";
import {
  LayoutEngine,
  type LayoutBlock,
  type LayoutPretextBlock
} from "../layout/layout-engine";
import { CanvasRenderer } from "../renderer/canvas-renderer";
import { DisplayListBuilder } from "../renderer/display-list-builder";
import { BookParser } from "../parser/book-parser";
import {
  normalizeEpubInput,
  type EpubInput
} from "../container/normalize-input";
import type {
  BlockNode,
  Book,
  HitTestResult,
  InlineNode,
  Locator,
  Point,
  RenderMetrics,
  ReaderEvent,
  ReaderEventMap,
  ReaderOptions,
  SectionDocument,
  SearchResult,
  Theme,
  TypographyOptions,
  VisibleDrawBounds
} from "../model/types";
import type {
  InteractionRegion,
  SectionDisplayList
} from "../renderer/draw-ops";

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
  pageNumberInSection: number;
  totalPagesInSection: number;
  spineIndex: number;
  sectionId: string;
  sectionHref: string;
  blocks: PageBlockSlice[];
};

type RenderBehavior = "relocate" | "preserve";

type ScrollAnchor = {
  sectionId: string;
  offsetWithinSection: number;
  fallbackScrollTop: number;
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
  private readonly displayListBuilder = new DisplayListBuilder();
  private readonly canvasRenderer = new CanvasRenderer();

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
  private isProgrammaticScroll = false;
  private sectionEstimatedHeights: number[] = [];
  private scrollWindowStart = -1;
  private scrollWindowEnd = -1;
  private scrollSyncFrame: number | null = null;
  private scrollRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private lastVisibleBounds: VisibleDrawBounds = [];
  private lastInteractionRegions: InteractionRegion[] = [];
  private lastRenderedSectionIds: string[] = [];
  private lastScrollRenderWindows = new Map<string, Array<{ top: number; height: number }>>();
  private highlightedBlockIds = new Set<string>();
  private lastRenderMetrics: RenderMetrics = {
    backend: "canvas",
    visibleSectionCount: 0,
    visibleDrawOpCount: 0,
    highlightedDrawOpCount: 0,
    totalCanvasHeight: 0
  };
  private renderVersion = 0;

  private static readonly SCROLL_WINDOW_RADIUS = 1;
  private static readonly SCROLL_SLICE_OVERSCAN_MULTIPLIER = 0.75;

  constructor(private readonly options: ReaderOptions = {}) {
    this.mode = options.mode ?? "scroll";
    this.theme = { ...DEFAULT_THEME, ...options.theme };
    this.typography = { ...DEFAULT_TYPOGRAPHY, ...options.typography };
    this.attachResizeObserver();
    this.attachScrollListener();
    this.attachPointerListener();
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
    this.sectionEstimatedHeights = [];
    this.currentPageNumber = 1;
    this.scrollWindowStart = -1;
    this.scrollWindowEnd = -1;
    this.renderVersion += 1;
    this.lastVisibleBounds = [];
    this.lastInteractionRegions = [];
    this.lastRenderedSectionIds = [];
    this.lastScrollRenderWindows.clear();
    this.lastRenderMetrics = {
      backend: "canvas",
      visibleSectionCount: 0,
      visibleDrawOpCount: 0,
      highlightedDrawOpCount: 0,
      totalCanvasHeight: 0
    };
    this.clearDeferredScrollRefresh();
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

    this.ensurePages();
    const nextPage = Math.min(
      this.currentPageNumber + 1,
      this.pages.length || 1
    );
    await this.goToPage(nextPage);
  }

  async prev(): Promise<void> {
    if (!this.book) {
      return;
    }

    this.ensurePages();
    const previousPage = Math.max(this.currentPageNumber - 1, 1);
    await this.goToPage(previousPage);
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
    if (this.mode === "paginated") {
      this.ensurePages();
      const targetPage = this.findPageForLocator({
        ...locator,
        spineIndex: nextIndex
      });
      if (targetPage) {
        this.currentPageNumber = targetPage.pageNumber;
      }
    }
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

    const [targetHref, targetAnchor] = splitHrefFragment(tocItem.href);
    const normalizedTargetHref = normalizeBookHref(targetHref);

    const targetIndex = this.book.sections.findIndex((section) => {
      const normalizedSectionHref = normalizeBookHref(section.href);
      return (
        normalizedSectionHref === normalizedTargetHref ||
        normalizedTargetHref.endsWith(normalizedSectionHref) ||
        normalizedSectionHref.endsWith(normalizedTargetHref)
      );
    });

    if (targetIndex >= 0) {
      const section = this.book.sections[targetIndex];
      const blockId =
        section && targetAnchor ? section.anchors[targetAnchor] : undefined;
      const locator: Locator = {
        spineIndex: targetIndex,
        progressInSection: 0
      };
      if (blockId) {
        locator.blockId = blockId;
      }
      await this.goToLocation(locator);
    }
  }

  async setTheme(theme: Partial<Theme>): Promise<void> {
    this.theme = { ...this.theme, ...theme };
    this.applyContainerTheme();
    await this.waitForFonts();
    this.pages = [];
    this.renderCurrentSection("preserve");
    this.events.emit("themeChanged", { theme: this.theme });
  }

  async setTypography(options: Partial<TypographyOptions>): Promise<void> {
    this.typography = { ...this.typography, ...options };
    await this.waitForFonts();
    this.pages = [];
    this.renderCurrentSection("preserve");
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

    const nextPage =
      this.pages[Math.max(0, Math.min(pageNumber - 1, this.pages.length - 1))];
    if (!nextPage) {
      return;
    }

    this.currentSectionIndex = nextPage.spineIndex;
    this.currentPageNumber = nextPage.pageNumber;
    this.locator = this.createLocatorForPage(nextPage);
    this.renderCurrentSection();
    this.events.emit("relocated", { locator: this.locator });
  }

  async search(query: string): Promise<SearchResult[]> {
    if (!this.book || !query.trim()) {
      return [];
    }

    const normalizedQuery = query.trim().toLowerCase();
    const results: SearchResult[] = [];
    this.highlightedBlockIds.clear();

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
        this.highlightedBlockIds.add(block.id);
      }
    }

    this.renderCurrentSection("preserve");
    this.events.emit("searchCompleted", { query, results });
    return results;
  }

  getCurrentLocation(): Locator | null {
    return this.locator;
  }

  hitTest(point: Point): HitTestResult | null {
    if (!this.options.container) {
      return null;
    }

    const hit = this.canvasRenderer.hitTest(
      {
        sections: this.collectRenderedCanvasSections(),
        bounds: this.lastVisibleBounds,
        drawOpCount: this.lastRenderMetrics.visibleDrawOpCount,
        totalCanvasHeight: this.lastRenderMetrics.totalCanvasHeight
      },
      point,
      this.mode === "scroll" ? this.options.container.scrollTop : 0
    );

    if (!hit) {
      return null;
    }

    return hit;
  }

  getVisibleDrawBounds(): VisibleDrawBounds {
    return [...this.lastVisibleBounds];
  }

  getRenderMetrics(): RenderMetrics {
    return { ...this.lastRenderMetrics };
  }

  mapLocatorToViewport(locator: Locator): VisibleDrawBounds {
    if (!this.book || !this.options.container) {
      return [];
    }

    const targetBlockId = locator.blockId;
    const targetSectionId = this.book.sections[locator.spineIndex]?.id;
    if (!targetSectionId) {
      return [];
    }

    return this.lastInteractionRegions
      .filter((region) =>
        region.sectionId === targetSectionId &&
        (targetBlockId ? region.blockId === targetBlockId : true)
      )
      .map((region) => region.rect);
  }

  mapViewportToLocator(point: Point): Locator | null {
    if (!this.book || !this.options.container) {
      return null;
    }

    const hit = this.hitTest(point);
    return hit?.locator
      ? {
          ...hit.locator,
          blockId: hit.blockId
        }
      : null;
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
    this.sectionEstimatedHeights = [];
    this.currentPageNumber = 1;
    this.scrollWindowStart = -1;
    this.scrollWindowEnd = -1;
    this.lastVisibleBounds = [];
    this.lastInteractionRegions = [];
    this.lastRenderedSectionIds = [];
    this.lastScrollRenderWindows.clear();
    this.lastRenderMetrics = {
      backend: "canvas",
      visibleSectionCount: 0,
      visibleDrawOpCount: 0,
      highlightedDrawOpCount: 0,
      totalCanvasHeight: 0
    };
    this.clearDeferredScrollRefresh();
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
      currentPage: Math.max(
        1,
        Math.min(this.currentPageNumber, this.pages.length || 1)
      ),
      totalPages: Math.max(1, this.pages.length)
    };
  }

  private findTocItem(
    items: Book["toc"],
    id: string
  ): Book["toc"][number] | null {
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

  private async goToHref(href: string): Promise<void> {
    if (!this.book) {
      return;
    }

    if (/^[a-z]+:\/\//i.test(href)) {
      return;
    }

    const [targetHref, targetAnchor] = splitHrefFragment(href);
    const normalizedTargetHref = normalizeBookHref(targetHref);
    const targetIndex = this.book.sections.findIndex((section) => {
      const normalizedSectionHref = normalizeBookHref(section.href);
      return (
        normalizedSectionHref === normalizedTargetHref ||
        normalizedTargetHref.endsWith(normalizedSectionHref) ||
        normalizedSectionHref.endsWith(normalizedTargetHref)
      );
    });

    if (targetIndex < 0) {
      return;
    }

    const section = this.book.sections[targetIndex];
    const blockId =
      section && targetAnchor ? section.anchors[targetAnchor] : undefined;
    await this.goToLocation({
      spineIndex: targetIndex,
      progressInSection: 0,
      ...(blockId ? { blockId } : {})
    });
  }

  private renderCurrentSection(renderBehavior: RenderBehavior = "relocate"): void {
    if (!this.book || !this.options.container) {
      return;
    }

    const preservedScrollAnchor =
      this.mode === "scroll" && renderBehavior === "preserve"
        ? this.captureScrollAnchor()
        : null;
    if (this.mode === "scroll" && renderBehavior === "preserve") {
      this.syncPositionFromScroll(false);
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
    const renderVersion = ++this.renderVersion;
    if (this.mode === "paginated") {
      this.ensurePages(layout);
      const currentPage = this.resolveRenderedPage(section.id);
      this.renderPaginatedCanvas(section, currentPage, renderVersion);
      if (currentPage) {
        this.currentPageNumber = currentPage.pageNumber;
        this.locator = {
          ...this.locator,
          spineIndex: currentPage.spineIndex,
          progressInSection:
            currentPage.totalPagesInSection > 1
              ? (currentPage.pageNumberInSection - 1) /
                (currentPage.totalPagesInSection - 1)
              : 0
        };
      }
    } else {
      this.ensurePages();
      this.updateScrollWindowBounds();
      this.renderScrollableCanvas(renderVersion);
      if (renderBehavior === "relocate") {
        this.scrollToCurrentLocation();
      } else {
        this.restoreScrollAnchor(preservedScrollAnchor);
      }
      if (this.locator?.blockId) {
        this.syncCurrentPageFromSection();
        this.locator = {
          ...this.locator,
          spineIndex: this.currentSectionIndex,
          progressInSection: this.getProgressForCurrentLocator()
        };
        return;
      }
      if (!this.syncPositionFromScroll(false)) {
        this.syncCurrentPageFromSection();
        this.locator = {
          ...this.locator,
          spineIndex: this.currentSectionIndex,
          progressInSection: this.getProgressForCurrentLocator()
        };
      }
    }
  }

  private applyContainerTheme(): void {
    if (!this.options.container) {
      return;
    }

    const darkTheme = isDarkColor(this.theme.background);
    this.options.container.style.background = this.theme.background;
    this.options.container.style.color = this.theme.color;
    this.options.container.style.fontSize = `${this.typography.fontSize}px`;
    this.options.container.style.lineHeight = String(
      this.typography.lineHeight
    );
    this.options.container.style.setProperty(
      "--reader-code-bg",
      darkTheme ? "#0b1220" : "#f4f4f5"
    );
    this.options.container.style.setProperty(
      "--reader-code-color",
      darkTheme ? "#e6edf7" : this.theme.color
    );
    this.options.container.style.setProperty(
      "--reader-inline-code-bg",
      darkTheme ? "rgba(148, 163, 184, 0.16)" : "rgba(15, 23, 42, 0.06)"
    );
    this.options.container.style.setProperty(
      "--reader-inline-code-color",
      darkTheme ? "#f8fafc" : "#0f172a"
    );
  }

  private renderPaginatedCanvas(
    section: SectionDocument,
    page: ReaderPage | null,
    renderVersion: number
  ): void {
    if (!this.options.container || !page || renderVersion !== this.renderVersion) {
      return;
    }

    const displayList = this.buildDisplayListForPage(section, page);
    const result = this.canvasRenderer.renderPaginated(
      this.options.container,
      displayList,
      this.getPageHeight(),
      this.options.canvas
    );
    this.lastInteractionRegions = result.sections.flatMap((entry) => entry.interactions);
    this.lastVisibleBounds = result.bounds;
    this.lastRenderedSectionIds = [section.id];
    const highlightedDrawOpCount = displayList.ops.filter(
      (op) => op.kind === "text" && Boolean(op.highlightColor)
    ).length;
    this.lastRenderMetrics = {
      backend: "canvas",
      visibleSectionCount: result.sections.length,
      visibleDrawOpCount: result.drawOpCount,
      highlightedDrawOpCount,
      totalCanvasHeight: result.totalCanvasHeight
    };
  }

  private renderScrollableCanvas(renderVersion: number): void {
    if (!this.book || !this.options.container || renderVersion !== this.renderVersion) {
      return;
    }

    const sectionsToRender: Array<{
      sectionId: string;
      sectionHref: string;
      height: number;
      displayList?: SectionDisplayList;
      renderWindows?: Array<{
        top: number;
        height: number;
      }>;
    }> = [];
    const measuredSectionHeights: number[] = [];

    for (let index = 0; index < this.book.sections.length; index += 1) {
      const section = this.book.sections[index];
      if (!section) {
        continue;
      }

      if (index < this.scrollWindowStart || index > this.scrollWindowEnd) {
        const height = this.getSectionHeight(section.id);
        measuredSectionHeights[index] = height;
        sectionsToRender.push({
          sectionId: section.id,
          sectionHref: section.href,
          height
        });
        continue;
      }

      const layout = this.layoutEngine.layout(
        {
          section,
          spineIndex: index,
          viewportWidth: this.getContentWidth(),
          viewportHeight: this.options.container.clientHeight,
          typography: this.typography,
          fontFamily: this.getFontFamily()
        },
        "scroll"
      );
      this.lastMeasuredWidth = layout.width;
      const displayList = this.displayListBuilder.buildSection({
        section,
        width: layout.width,
        viewportHeight: this.options.container.clientHeight,
        blocks: layout.blocks,
        theme: this.theme,
        typography: this.typography,
        locatorMap: layout.locatorMap,
        resolveImageLoaded: (src) => this.isImageResourceReady(src),
        resolveImageUrl: (src) => this.resolveRenderableResourceUrl(src),
        highlightedBlockIds: this.highlightedBlockIds,
        activeBlockId: this.locator?.blockId
      });
      this.sectionEstimatedHeights[index] = Math.max(
        this.getPageHeight(),
        displayList.height
      );
      measuredSectionHeights[index] = displayList.height;
      sectionsToRender.push({
        sectionId: section.id,
        sectionHref: section.href,
        height: displayList.height,
        displayList
      });
    }

    const viewportTop = this.options.container.scrollTop;
    const viewportBottom = viewportTop + this.options.container.clientHeight;
    const overscan = this.options.container.clientHeight *
      EpubReader.SCROLL_SLICE_OVERSCAN_MULTIPLIER;
    let runningTop = 0;
    sectionsToRender.forEach((entry, index) => {
      const height = measuredSectionHeights[index] ?? entry.height;
      entry.height = height;
      if (entry.displayList) {
        const currentRenderTop = Math.max(0, viewportTop - overscan - runningTop);
        const currentRenderBottom = Math.min(
          height,
          viewportBottom + overscan - runningTop
        );
        if (currentRenderBottom > currentRenderTop) {
          const currentWindow = {
            top: currentRenderTop,
            height: currentRenderBottom - currentRenderTop
          };
          const previousTop = Math.max(0, currentWindow.top - currentWindow.height);
          const previousHeight = Math.max(0, currentWindow.top - previousTop);
          const nextTop = Math.min(height, currentWindow.top + currentWindow.height);
          const nextHeight = Math.max(
            0,
            Math.min(currentWindow.height, height - nextTop)
          );
          const previousWindow = {
            top: previousTop,
            height: previousHeight
          };
          const nextWindow = {
            top: nextTop,
            height: nextHeight
          };
          entry.renderWindows = dedupeScrollRenderWindows([
            previousWindow,
            currentWindow,
            nextWindow
          ]);
        }
      }
      runningTop += height;
    });
    this.lastScrollRenderWindows.clear();
    for (const entry of sectionsToRender) {
      if (entry.displayList && entry.renderWindows) {
        this.lastScrollRenderWindows.set(entry.sectionId, entry.renderWindows);
      }
    }

    const result = this.canvasRenderer.renderScrollable(
      this.options.container,
      sectionsToRender,
      this.options.canvas
    );
    this.lastInteractionRegions = this.offsetInteractionRegionsForScroll(result.sections);
    this.lastVisibleBounds = this.collectVisibleBoundsForScroll(sectionsToRender);
    this.lastRenderedSectionIds = result.sections.map((entry) => entry.sectionId);
    const highlightedDrawOpCount = sectionsToRender
      .flatMap((entry) => entry.displayList?.ops ?? [])
      .filter((op) => op.kind === "text" && Boolean(op.highlightColor)).length;
    this.lastRenderMetrics = {
      backend: "canvas",
      visibleSectionCount: result.sections.length,
      visibleDrawOpCount: result.drawOpCount,
      highlightedDrawOpCount,
      totalCanvasHeight: result.totalCanvasHeight
    };
  }

  private buildDisplayListForPage(
    section: SectionDocument,
    page: ReaderPage
  ): SectionDisplayList {
    const blocks = page.blocks.map((slice) =>
      slice.type === "pretext"
        ? ({
            ...slice.block,
            lines: slice.block.lines.slice(slice.lineStart, slice.lineEnd),
            estimatedHeight:
              (slice.lineEnd - slice.lineStart) * slice.block.lineHeight +
              slice.block.lineHeight *
                (slice.block.kind === "heading" ? 0.45 : 0.55)
          } satisfies LayoutPretextBlock)
        : ({
            type: "native",
            id: slice.block.id,
            block: slice.block,
            estimatedHeight: this.estimateBlockHeightForPage(slice.block)
          } satisfies LayoutBlock)
    ) as LayoutBlock[];

    const locatorMap = new Map<string, Locator>();
    for (const block of blocks) {
      locatorMap.set(block.id, {
        spineIndex: page.spineIndex,
        blockId: block.id,
        progressInSection:
          page.totalPagesInSection > 1
            ? (page.pageNumberInSection - 1) / (page.totalPagesInSection - 1)
            : 0
      });
    }

    return this.displayListBuilder.buildSection({
      section,
      width: this.getContentWidth(),
      viewportHeight: this.options.container?.clientHeight ?? 720,
      blocks,
      theme: this.theme,
      typography: this.typography,
      locatorMap,
      resolveImageLoaded: (src) => this.isImageResourceReady(src),
      resolveImageUrl: (src) => this.resolveRenderableResourceUrl(src),
      highlightedBlockIds: this.highlightedBlockIds,
      activeBlockId: this.locator?.blockId
    });
  }

  private estimateBlockHeightForPage(block: BlockNode): number {
    return this.layoutEngine
      .layout(
        {
          section: {
            id: "estimate",
            href: "estimate.xhtml",
            blocks: [block],
            anchors: {}
          },
          spineIndex: 0,
          viewportWidth: this.getContentWidth(),
          viewportHeight: this.options.container?.clientHeight ?? 720,
          typography: this.typography,
          fontFamily: this.getFontFamily()
        },
        "paginated"
      )
      .blocks[0]?.estimatedHeight ?? this.typography.fontSize * this.typography.lineHeight;
  }

  private isImageResourceReady(src: string): boolean {
    const resolved = this.objectUrls.get(src);
    return typeof resolved === "string" && resolved.startsWith("blob:");
  }

  private extractBlockText(block: BlockNode): string {
    switch (block.kind) {
      case "heading":
      case "text":
        return this.extractInlineText(block.inlines);
      case "quote":
        return block.blocks
          .map((child) => this.extractBlockText(child))
          .join(" ");
      case "code":
        return block.text;
      case "image":
        return block.alt ?? "";
      case "list":
        return block.items
          .flatMap((item) =>
            item.blocks.map((child) => this.extractBlockText(child))
          )
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

  private resolveRenderableResourceUrl(path: string): string {
    if (
      !this.resources ||
      typeof Blob === "undefined" ||
      typeof URL === "undefined"
    ) {
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
        if (
          previous &&
          previous !== path &&
          typeof URL.revokeObjectURL === "function"
        ) {
          URL.revokeObjectURL(previous);
        }
        this.objectUrls.set(path, objectUrl);
        this.renderCurrentSection("preserve");
      })
      .catch(() => {
        // Keep the original path when the resource cannot be resolved.
      });

    this.objectUrls.set(path, placeholder);
    return placeholder;
  }

  private revokeObjectUrls(): void {
    if (
      typeof URL === "undefined" ||
      typeof URL.revokeObjectURL !== "function"
    ) {
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

  private getContentWidth(): number {
    if (!this.options.container) {
      return 672;
    }

    const container = this.options.container;
    const computed =
      typeof window !== "undefined" &&
      typeof window.getComputedStyle === "function"
        ? window.getComputedStyle(container)
        : null;
    const paddingLeft = computed
      ? Number.parseFloat(computed.paddingLeft) || 0
      : 0;
    const paddingRight = computed
      ? Number.parseFloat(computed.paddingRight) || 0
      : 0;
    const rootFontSize =
      typeof document !== "undefined"
        ? Number.parseFloat(
            window.getComputedStyle(document.documentElement).fontSize
          ) || 16
        : 16;
    const maxContentWidth = 42 * rootFontSize;
    const available = Math.max(
      120,
      container.clientWidth - paddingLeft - paddingRight
    );
    return Math.min(available, maxContentWidth);
  }

  private getFontFamily(): string {
    if (!this.options.container || typeof window === "undefined") {
      return '"Iowan Old Style", "Palatino Linotype", serif';
    }

    const fontFamily = window
      .getComputedStyle(this.options.container)
      .fontFamily.trim();
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
      this.renderCurrentSection("preserve");
    });

    this.resizeObserver.observe(this.options.container);
  }

  private attachScrollListener(): void {
    if (!this.options.container) {
      return;
    }

    this.options.container.addEventListener("scroll", () => {
      if (this.mode !== "scroll") {
        return;
      }

      const emitEvent = !this.isProgrammaticScroll;
      if (
        typeof window === "undefined" ||
        typeof window.requestAnimationFrame !== "function"
      ) {
        this.syncPositionFromScroll(emitEvent);
        this.refreshScrollWindowIfNeeded();
        this.refreshScrollSlicesIfNeeded();
        this.scheduleDeferredScrollRefresh();
        this.isProgrammaticScroll = false;
        return;
      }

      if (this.scrollSyncFrame !== null) {
        return;
      }

      this.scrollSyncFrame = window.requestAnimationFrame(() => {
        this.scrollSyncFrame = null;
        this.syncPositionFromScroll(emitEvent);
        const refreshedWindow = this.refreshScrollWindowIfNeeded();
        if (!refreshedWindow) {
          this.refreshScrollSlicesIfNeeded();
        }
        this.scheduleDeferredScrollRefresh();
        this.isProgrammaticScroll = false;
      });
    });
  }

  private attachPointerListener(): void {
    if (!this.options.container) {
      return;
    }

    this.options.container.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !this.options.container) {
        return;
      }

      const bounds = this.options.container.getBoundingClientRect();
      const hit = this.hitTest({
        x: event.clientX - bounds.left + this.options.container.scrollLeft,
        y: event.clientY - bounds.top
      });

      if (!hit) {
        return;
      }

      if (hit.kind === "link") {
        event.preventDefault();
        void this.goToHref(hit.href);
        return;
      }

      if (hit.locator) {
        this.locator = {
          ...hit.locator,
          blockId: hit.blockId
        };
        this.currentSectionIndex = hit.locator.spineIndex;
        this.syncCurrentPageFromSection();
        this.events.emit("relocated", { locator: this.locator });
      }
    });
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

  private ensurePages(
    sectionLayout?: ReturnType<LayoutEngine["layout"]>
  ): void {
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
        pageNumberInSection: 1,
        totalPagesInSection: 1,
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
            let lineCapacity = Math.max(
              1,
              Math.floor(remainingHeight / layoutBlock.lineHeight)
            );
            if (lineCapacity <= 0 && currentPage.blocks.length > 0) {
              pages.push(currentPage);
              pageNumber += 1;
              currentPage = {
                pageNumber,
                pageNumberInSection: currentPage.pageNumberInSection + 1,
                totalPagesInSection: 1,
                spineIndex: index,
                sectionId: section.id,
                sectionHref: section.href,
                blocks: []
              };
              usedHeight = 0;
              lineCapacity = Math.max(
                1,
                Math.floor(pageHeight / layoutBlock.lineHeight)
              );
            }

            const lineEnd = Math.min(
              layoutBlock.lines.length,
              lineStart + lineCapacity
            );
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
                pageNumberInSection: currentPage.pageNumberInSection + 1,
                totalPagesInSection: 1,
                spineIndex: index,
                sectionId: section.id,
                sectionHref: section.href,
                blocks: []
              };
              usedHeight = 0;
            }
          }

          usedHeight +=
            layoutBlock.lineHeight *
            (layoutBlock.kind === "heading" ? 0.45 : 0.55);
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
            pageNumberInSection: currentPage.pageNumberInSection + 1,
            totalPagesInSection: 1,
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

    const totalPagesBySection = new Map<string, number>();
    for (const page of pages) {
      totalPagesBySection.set(
        page.sectionId,
        (totalPagesBySection.get(page.sectionId) ?? 0) + 1
      );
    }

    this.sectionEstimatedHeights = this.book.sections.map((section) => {
      const sectionPageCount = totalPagesBySection.get(section.id) ?? 1;
      return Math.max(pageHeight, sectionPageCount * pageHeight);
    });

    this.pages = pages.map((page, index) => ({
      ...page,
      pageNumber: index + 1,
      totalPagesInSection: totalPagesBySection.get(page.sectionId) ?? 1
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
          entry.pageNumber === this.currentPageNumber &&
          entry.sectionId === sectionId
      ) ??
      this.pages.find((entry) => entry.sectionId === sectionId) ??
      null;

    return page;
  }

  private findPageForLocator(locator: Locator): ReaderPage | null {
    const sectionPages = this.pages.filter(
      (page) => page.spineIndex === locator.spineIndex
    );
    if (sectionPages.length === 0) {
      return null;
    }

    if (locator.blockId) {
      const blockPage = sectionPages.find((page) =>
        this.pageContainsBlockId(page, locator.blockId!)
      );
      if (blockPage) {
        return blockPage;
      }
    }

    const sectionProgress = locator.progressInSection ?? 0;
    const progress = Number.isFinite(sectionProgress)
      ? Math.max(0, Math.min(sectionProgress, 1))
      : 0;
    const targetIndex = Math.min(
      sectionPages.length - 1,
      Math.round(progress * Math.max(sectionPages.length - 1, 0))
    );

    return sectionPages[targetIndex] ?? sectionPages[0] ?? null;
  }

  private resolveRenderedPage(sectionId: string): ReaderPage | null {
    const currentPage = this.findCurrentPageForSection(sectionId);
    if (currentPage) {
      return currentPage;
    }

    if (this.locator) {
      const locatorPage = this.findPageForLocator(this.locator);
      if (locatorPage?.sectionId === sectionId) {
        return locatorPage;
      }
    }

    return this.pages.find((entry) => entry.sectionId === sectionId) ?? null;
  }

  private syncCurrentPageFromSection(): void {
    const matchingPage = this.locator
      ? this.findPageForLocator({
          ...this.locator,
          spineIndex: this.currentSectionIndex
        })
      : null;
    this.currentPageNumber =
      matchingPage?.pageNumber ?? this.currentSectionIndex + 1;
  }

  private createLocatorForPage(page: ReaderPage): Locator {
    return {
      spineIndex: page.spineIndex,
      progressInSection:
        page.totalPagesInSection > 1
          ? (page.pageNumberInSection - 1) / (page.totalPagesInSection - 1)
          : 0
    };
  }

  private pageContainsBlockId(page: ReaderPage, blockId: string): boolean {
    return page.blocks.some((slice) =>
      slice.type === "pretext"
        ? slice.block.id === blockId
        : slice.block.id === blockId
    );
  }

  private getProgressForCurrentLocator(): number {
    if (!this.locator) {
      return 0;
    }

    const page = this.findPageForLocator({
      ...this.locator,
      spineIndex: this.currentSectionIndex
    });
    if (!page) {
      return this.locator.progressInSection ?? 0;
    }

    return page.totalPagesInSection > 1
      ? (page.pageNumberInSection - 1) / (page.totalPagesInSection - 1)
      : 0;
  }

  private scrollToLocatorBlock(): void {
    if (!this.options.container || !this.locator?.blockId) {
      return;
    }

    const blockRegion = this.lastInteractionRegions.find(
      (region) =>
        region.kind === "block" &&
        region.blockId === this.locator?.blockId &&
        region.sectionId === this.book?.sections[this.currentSectionIndex]?.id
    );
    if (!blockRegion) {
      return;
    }
    this.options.container.scrollTop = Math.max(0, blockRegion.rect.y - 16);
  }

  private scrollToCurrentLocation(): void {
    if (!this.options.container) {
      return;
    }

    if (this.locator?.blockId) {
      this.isProgrammaticScroll = true;
      this.scrollToLocatorBlock();
      return;
    }

    const section = this.book?.sections[this.currentSectionIndex];
    if (!section) {
      this.isProgrammaticScroll = true;
      this.options.container.scrollTop = 0;
      return;
    }

    const sectionTop = this.getSectionTop(section.id);
    const sectionHeight = this.getSectionHeight(section.id);
    const progress = this.locator?.progressInSection ?? 0;
    const targetTop =
      sectionTop +
      Math.max(0, Math.min(progress, 1)) *
        Math.max(0, sectionHeight - this.options.container.clientHeight);
    this.isProgrammaticScroll = true;
    this.options.container.scrollTop = Math.max(0, targetTop);
  }

  private syncPositionFromScroll(emitEvent: boolean): boolean {
    if (!this.options.container || !this.book || this.mode !== "scroll") {
      return false;
    }

    const preservedBlockId = emitEvent ? undefined : this.locator?.blockId;

    const probe =
      this.options.container.scrollTop +
      this.options.container.clientHeight * 0.5;
    const nextSectionIndex = this.findSectionIndexForOffset(probe);
    if (nextSectionIndex < 0) {
      return false;
    }
    const section = this.book.sections[nextSectionIndex];
    if (!section) {
      return false;
    }
    const sectionTop = this.getSectionTop(section.id);
    const sectionHeight = Math.max(1, this.getSectionHeight(section.id));
    const localOffset = probe - sectionTop;
    const progress = Math.max(0, Math.min(localOffset / sectionHeight, 1));
    this.currentSectionIndex = nextSectionIndex;
    this.locator = {
      spineIndex: nextSectionIndex,
      progressInSection: progress,
      ...(preservedBlockId ? { blockId: preservedBlockId } : {})
    };
    this.syncCurrentPageFromSection();

    if (emitEvent) {
      this.events.emit("relocated", { locator: this.locator });
    }

    return true;
  }

  private updateScrollWindowBounds(): void {
    if (!this.book) {
      this.scrollWindowStart = -1;
      this.scrollWindowEnd = -1;
      return;
    }

    this.scrollWindowStart = Math.max(
      0,
      this.currentSectionIndex - EpubReader.SCROLL_WINDOW_RADIUS
    );
    this.scrollWindowEnd = Math.min(
      this.book.sections.length - 1,
      this.currentSectionIndex + EpubReader.SCROLL_WINDOW_RADIUS
    );
  }

  private refreshScrollWindowIfNeeded(): boolean {
    if (!this.options.container || !this.book || this.mode !== "scroll") {
      return false;
    }

    if (
      this.scrollWindowStart >= 0 &&
      this.scrollWindowEnd >= 0 &&
      this.currentSectionIndex >= this.scrollWindowStart &&
      this.currentSectionIndex <= this.scrollWindowEnd
    ) {
      return false;
    }

    const nextStart = Math.max(
      0,
      this.currentSectionIndex - EpubReader.SCROLL_WINDOW_RADIUS
    );
    const nextEnd = Math.min(
      this.book.sections.length - 1,
      this.currentSectionIndex + EpubReader.SCROLL_WINDOW_RADIUS
    );

    if (
      nextStart === this.scrollWindowStart &&
      nextEnd === this.scrollWindowEnd
    ) {
      return false;
    }

    const scrollAnchor = this.captureScrollAnchor();
    this.scrollWindowStart = nextStart;
    this.scrollWindowEnd = nextEnd;
    this.renderScrollableCanvas(this.renderVersion);
    this.restoreScrollAnchor(scrollAnchor);
    this.syncPositionFromScroll(false);
    return true;
  }

  private refreshScrollSlicesIfNeeded(): boolean {
    if (
      !this.options.container ||
      !this.book ||
      this.mode !== "scroll" ||
      this.lastRenderedSectionIds.length === 0
    ) {
      return false;
    }

    const viewportTop = this.options.container.scrollTop;
    const viewportBottom = viewportTop + this.options.container.clientHeight;
    const refreshGuard = Math.max(
      this.options.container.clientHeight * 0.2,
      48
    );

    for (const sectionId of this.lastRenderedSectionIds) {
      const window = this.lastScrollRenderWindows.get(sectionId);
      if (!window || window.length === 0) {
        this.renderScrollableCanvas(this.renderVersion);
        return true;
      }

      const sectionTop = this.getSectionTop(sectionId);
      const sectionHeight = this.getSectionHeight(sectionId);
      const visibleTop = Math.max(viewportTop, sectionTop);
      const visibleBottom = Math.min(viewportBottom, sectionTop + sectionHeight);
      if (visibleBottom <= visibleTop) {
        continue;
      }

      const localVisibleTop = visibleTop - sectionTop;
      const localVisibleBottom = visibleBottom - sectionTop;
      const coverageTop = Math.min(...window.map((entry) => entry.top));
      const coverageBottom = Math.max(
        ...window.map((entry) => entry.top + entry.height)
      );
      if (
        localVisibleTop < coverageTop + refreshGuard ||
        localVisibleBottom > coverageBottom - refreshGuard
      ) {
        this.renderScrollableCanvas(this.renderVersion);
        return true;
      }
    }

    return false;
  }

  private scheduleDeferredScrollRefresh(): void {
    if (!this.options.container || this.mode !== "scroll") {
      return;
    }

    this.clearDeferredScrollRefresh();
    this.scrollRefreshTimer = setTimeout(() => {
      this.scrollRefreshTimer = null;
      this.refreshScrollWindowIfNeeded();
    }, 90);
  }

  private clearDeferredScrollRefresh(): void {
    if (this.scrollRefreshTimer !== null) {
      clearTimeout(this.scrollRefreshTimer);
      this.scrollRefreshTimer = null;
    }
  }

  private captureScrollAnchor(): ScrollAnchor | null {
    if (!this.options.container || !this.book) {
      return null;
    }

    const scrollTop = this.options.container.scrollTop;
    const sectionIndex = this.findSectionIndexForOffset(scrollTop);
    const section = this.book.sections[sectionIndex];
    if (!section) {
      return {
        sectionId: "",
        offsetWithinSection: 0,
        fallbackScrollTop: scrollTop
      };
    }

    return {
      sectionId: section.id,
      offsetWithinSection: Math.max(0, scrollTop - this.getSectionTop(section.id)),
      fallbackScrollTop: scrollTop
    };
  }

  private restoreScrollAnchor(anchor: ScrollAnchor | null): void {
    if (!this.options.container) {
      return;
    }

    this.isProgrammaticScroll = true;
    if (!anchor || !anchor.sectionId) {
      this.options.container.scrollTop = anchor?.fallbackScrollTop ?? this.options.container.scrollTop;
      return;
    }

    const sectionTop = this.getSectionTop(anchor.sectionId);
    this.options.container.scrollTop = Math.max(
      0,
      sectionTop + anchor.offsetWithinSection
    );
  }

  private collectRenderedCanvasSections(): Array<{
    sectionId: string;
    height: number;
    canvas: HTMLCanvasElement;
    interactions: InteractionRegion[];
  }> {
    if (!this.options.container || !this.book) {
      return [];
    }

    return this.lastRenderedSectionIds.map((sectionId) => {
      const sectionTop = this.getSectionTop(sectionId);
      return {
        sectionId,
        height: this.getSectionHeight(sectionId),
        canvas: this.options.canvas ?? document.createElement("canvas"),
        interactions: this.lastInteractionRegions
          .filter((region) => region.sectionId === sectionId)
          .map((region) => ({
            ...region,
            rect: {
              ...region.rect,
              y: region.rect.y - sectionTop
            }
          }))
      };
    });
  }

  private offsetInteractionRegionsForScroll(
    sections: Array<{
      sectionId: string;
      height: number;
      interactions: InteractionRegion[];
    }>
  ): InteractionRegion[] {
    const regions: InteractionRegion[] = [];
    for (const section of sections) {
      const sectionTop = this.getSectionTop(section.sectionId);
      for (const interaction of section.interactions) {
        regions.push({
          ...interaction,
          rect: {
            ...interaction.rect,
            y: interaction.rect.y + sectionTop
          }
        });
      }
    }
    return regions;
  }

  private collectVisibleBoundsForScroll(
    sectionsToRender: Array<{
      sectionId: string;
      sectionHref: string;
      height: number;
      displayList?: SectionDisplayList;
      renderWindows?: Array<{
        top: number;
        height: number;
      }>;
    }>
  ): VisibleDrawBounds {
    const bounds: VisibleDrawBounds = [];
    for (const section of sectionsToRender) {
      if (!section.displayList) {
        continue;
      }
      const sectionTop = this.getSectionTop(section.sectionId);
      const renderWindows = section.renderWindows?.length
        ? section.renderWindows
        : [{ top: 0, height: section.displayList.height }];
      for (const op of section.displayList.ops) {
        const opBottom = op.rect.y + op.rect.height;
        const intersectsWindow = renderWindows.some((window) => {
          const renderTop = window.top;
          const renderBottom = window.top + window.height;
          return opBottom > renderTop && op.rect.y < renderBottom;
        });
        if (!intersectsWindow) {
          continue;
        }
        bounds.push({
          ...op.rect,
          y: op.rect.y + sectionTop
        });
      }
    }
    return bounds;
  }

  private getSectionElement(sectionId: string): HTMLElement | null {
    if (!this.options.container) {
      return null;
    }

    return this.options.container.querySelector<HTMLElement>(
      `article[data-section-id="${sectionId}"]`
    );
  }

  private getSectionTop(sectionId: string): number {
    const sectionElement = this.getSectionElement(sectionId);
    const sectionIndex = this.book?.sections.findIndex(
      (section) => section.id === sectionId
    ) ?? -1;
    if (
      sectionElement &&
      Number.isFinite(sectionElement.offsetTop) &&
      (sectionIndex <= 0 || sectionElement.offsetTop > 0)
    ) {
      return sectionElement.offsetTop;
    }

    if (!this.book) {
      return 0;
    }

    let offset = 0;
    for (const section of this.book.sections) {
      if (section.id === sectionId) {
        return offset;
      }
      offset += this.getSectionHeight(section.id);
    }
    return 0;
  }

  private getSectionHeight(sectionId: string): number {
    const sectionElement = this.getSectionElement(sectionId);
    if (sectionElement && sectionElement.offsetHeight > 0) {
      return sectionElement.offsetHeight;
    }

    if (!this.book) {
      return this.getPageHeight();
    }
    const index = this.book.sections.findIndex((section) => section.id === sectionId);
    if (index < 0) {
      return this.getPageHeight();
    }
    return Math.max(this.getPageHeight(), this.sectionEstimatedHeights[index] ?? this.getPageHeight());
  }

  private findSectionIndexForOffset(offset: number): number {
    if (!this.book) {
      return -1;
    }

    let start = 0;
    for (let index = 0; index < this.book.sections.length; index += 1) {
      const section = this.book.sections[index];
      if (!section) {
        continue;
      }
      const end = start + this.getSectionHeight(section.id);
      if (offset >= start && offset < end) {
        return index;
      }
      start = end;
    }

    return this.book.sections.length - 1;
  }
}

function isDarkColor(color: string): boolean {
  const normalized = color.trim().toLowerCase();
  const hex = normalized.startsWith("#") ? normalized.slice(1) : normalized;
  if (hex.length !== 3 && hex.length !== 6) {
    return false;
  }

  const expanded =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : hex;

  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);

  if ([red, green, blue].some((value) => Number.isNaN(value))) {
    return false;
  }

  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance < 0.45;
}

function splitHrefFragment(href: string): [string, string | null] {
  const [baseHref, fragment] = href.split("#", 2);
  return [baseHref ?? href, fragment ?? null];
}

function normalizeBookHref(href: string): string {
  return href.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function dedupeScrollRenderWindows(
  windows: Array<{ top: number; height: number }>
): Array<{ top: number; height: number }> {
  const seen = new Set<string>();
  const deduped: Array<{ top: number; height: number }> = [];

  for (const window of windows) {
    if (window.height <= 0) {
      continue;
    }
    const key = `${window.top}:${window.height}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(window);
  }

  return deduped.sort((left, right) => left.top - right.top);
}
