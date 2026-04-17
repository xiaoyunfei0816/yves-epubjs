import EventEmitter from "eventemitter3";
import { getMimeTypeFromPath } from "../container/resource-mime";
import { resolveResourcePath } from "../container/resource-path";
import {
  LayoutEngine,
  type LayoutBlock,
  type LayoutPretextBlock
} from "../layout/layout-engine";
import { CanvasRenderer } from "../renderer/canvas-renderer";
import { DisplayListBuilder } from "../renderer/display-list-builder";
import {
  DomChapterRenderer,
  type DomChapterRenderInput
} from "../renderer/dom-chapter-renderer";
import {
  buildReadingStyleCssVariables,
  buildReadingStyleProfile
} from "../renderer/reading-style-profile";
import { BookParser } from "../parser/book-parser";
import {
  normalizeEpubInput,
  type EpubInput
} from "../container/normalize-input";
import type {
  BlockNode,
  Book,
  ChapterRenderDecision,
  HitTestResult,
  InlineNode,
  Locator,
  Point,
  RenderMetrics,
  RenderDiagnostics,
  ReaderEvent,
  ReaderEventMap,
  ReaderOptions,
  SectionDocument,
  SearchResult,
  Theme,
  TypographyOptions,
  VisibleSectionDiagnostics,
  VisibleDrawBounds
} from "../model/types";
import type {
  InteractionRegion,
  SectionDisplayList
} from "../renderer/draw-ops";
import {
  extractBlockText as collectBlockText,
  extractInlineText as collectInlineText
} from "../utils/block-text";
import { buildChapterAnalysisInput } from "./chapter-analysis-input";
import {
  analyzeChapterRenderMode
} from "./chapter-render-analyzer";
import { ChapterRenderDecisionCache } from "./chapter-render-decision-cache";
import {
  createSharedChapterRenderInput,
  type SharedChapterRenderInput
} from "./chapter-render-input";

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

type ResourceConsumer = "canvas" | "dom";

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
  private readonly domChapterRenderer = new DomChapterRenderer();
  private readonly chapterRenderDecisionCache = new ChapterRenderDecisionCache();

  private book: Book | null = null;
  private resources: {
    readBinary(path: string): Promise<Uint8Array>;
  } | null = null;
  private chapterRenderInputs: SharedChapterRenderInput[] = [];
  private locator: Locator | null = null;
  private mode: "scroll" | "paginated";
  private theme: Theme;
  private typography: TypographyOptions;
  private currentSectionIndex = 0;
  private readonly objectUrls = new Map<string, string>();
  private readonly pendingResourceConsumers = new Map<string, Set<ResourceConsumer>>();
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
  private resourceRenderRefreshTimer: ReturnType<typeof setTimeout> | null = null;
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
  private lastChapterRenderDecision: ChapterRenderDecision | null = null;

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
    this.chapterRenderInputs = parsed.sectionContents.map((entry) =>
      createSharedChapterRenderInput(entry)
    );
    this.locator = null;
    this.currentSectionIndex = 0;
    this.pages = [];
    this.sectionEstimatedHeights = [];
    this.pendingResourceConsumers.clear();
    this.currentPageNumber = 1;
    this.isProgrammaticScroll = false;
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
    this.lastChapterRenderDecision = null;
    this.clearDeferredScrollRefresh();
    this.clearDeferredResourceRenderRefresh();
    if (this.options.container) {
      this.options.container.scrollTop = 0;
      this.options.container.scrollLeft = 0;
    }
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

    const locator = this.resolveHrefLocator(tocItem.href);
    if (locator) {
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

  async goToSearchResult(result: SearchResult): Promise<void> {
    await this.goToLocation(result.locator);
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

  getRenderDiagnostics(): RenderDiagnostics | null {
    if (!this.book || !this.lastChapterRenderDecision) {
      return null;
    }

    const section = this.book.sections[this.currentSectionIndex];
    return {
      mode: this.lastChapterRenderDecision.mode,
      score: this.lastChapterRenderDecision.score,
      reasons: [...this.lastChapterRenderDecision.reasons],
      alignmentTarget: "dom-baseline",
      styleProfile: "shared",
      ...(section?.id ? { sectionId: section.id } : {}),
      ...(section?.href ? { sectionHref: section.href } : {})
    };
  }

  getVisibleSectionDiagnostics(): VisibleSectionDiagnostics[] {
    if (!this.book) {
      return [];
    }

    const visibleSectionIds = this.lastRenderedSectionIds.length
      ? this.lastRenderedSectionIds
      : this.book.sections[this.currentSectionIndex]?.id
        ? [this.book.sections[this.currentSectionIndex]!.id]
        : [];

    const diagnostics: VisibleSectionDiagnostics[] = [];
    for (const sectionId of visibleSectionIds) {
      const sectionIndex = this.book.sections.findIndex((section) => section.id === sectionId);
      if (sectionIndex < 0) {
        continue;
      }

      const section = this.book.sections[sectionIndex];
      if (!section) {
        continue;
      }

      const decision = this.resolveChapterRenderDecision(sectionIndex);
      diagnostics.push({
        mode: decision.mode,
        score: decision.score,
        reasons: [...decision.reasons],
        alignmentTarget: "dom-baseline",
        styleProfile: "shared",
        sectionId: section.id,
        sectionHref: section.href,
        isCurrent: sectionIndex === this.currentSectionIndex
      });
    }

    return diagnostics;
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
    this.chapterRenderInputs = [];
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
    this.lastChapterRenderDecision = null;
    this.clearDeferredScrollRefresh();
    this.clearDeferredResourceRenderRefresh();
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
    if (this.mode === "scroll") {
      this.syncCurrentPageFromSection();
    }
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

    const locator = this.resolveHrefLocator(href);
    if (locator) {
      await this.goToLocation(locator);
    }
  }

  private resolveHrefLocator(href: string): Locator | null {
    if (!this.book) {
      return null;
    }

    const [targetHref, targetAnchor] = splitHrefFragment(href);
    const targetIndex = targetHref.trim()
      ? this.book.sections.findIndex((section) => {
          const normalizedSectionHref = normalizeBookHref(section.href);
          const normalizedTargetHref = normalizeBookHref(targetHref);
          return (
            normalizedSectionHref === normalizedTargetHref ||
            normalizedTargetHref.endsWith(normalizedSectionHref) ||
            normalizedSectionHref.endsWith(normalizedTargetHref)
          );
        })
      : this.currentSectionIndex;

    if (targetIndex < 0) {
      return null;
    }

    const section = this.book.sections[targetIndex];
    const blockId =
      section && targetAnchor ? section.anchors[targetAnchor] : undefined;

    return {
      spineIndex: targetIndex,
      progressInSection: 0,
      ...(blockId ? { blockId } : {})
    };
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
      const anchoredSectionIndex = preservedScrollAnchor?.sectionId
        ? this.book.sections.findIndex(
            (candidate) => candidate.id === preservedScrollAnchor.sectionId
          )
        : -1;
      if (anchoredSectionIndex >= 0) {
        this.currentSectionIndex = anchoredSectionIndex;
      }
    }

    const section = this.book.sections[this.currentSectionIndex];
    if (!section) {
      return;
    }
    const chapterRenderDecision = this.resolveChapterRenderDecision(this.currentSectionIndex);
    this.lastChapterRenderDecision = chapterRenderDecision;

    this.applyContainerTheme();
    this.options.container.dataset.renderMode = chapterRenderDecision.mode;
    this.options.container.dataset.mode = this.mode;
    const renderVersion = ++this.renderVersion;
    if (this.mode === "paginated") {
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
      if (chapterRenderDecision.mode === "dom") {
        this.pages = [];
        this.currentPageNumber = 1;
        this.renderDomSection(section, renderVersion);
        this.syncDomSectionStateAfterRender(renderBehavior, preservedScrollAnchor);
        return;
      }
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
      this.lastMeasuredWidth = this.getContentWidth();
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
      if (
        renderBehavior === "preserve" &&
        preservedScrollAnchor &&
        !preservedScrollAnchor.sectionId &&
        this.locator
      ) {
        this.currentSectionIndex = this.locator.spineIndex
        this.syncCurrentPageFromSection()
        this.locator = {
          ...this.locator,
          spineIndex: this.currentSectionIndex,
          progressInSection: clampProgress(this.locator.progressInSection ?? 0)
        }
        return
      }
      if (renderBehavior === "preserve" && !this.locator) {
        this.currentPageNumber = this.currentSectionIndex + 1
        this.locator = {
          spineIndex: this.currentSectionIndex,
          progressInSection: 0
        }
        return
      }
      if (renderBehavior === "relocate" && !this.locator) {
        this.currentPageNumber = this.currentSectionIndex + 1
        this.locator = {
          spineIndex: this.currentSectionIndex,
          progressInSection: 0
        }
        return
      }
      if (renderBehavior === "relocate" && this.locator) {
        this.syncCurrentPageFromSection();
        this.locator = {
          ...this.locator,
          spineIndex: this.currentSectionIndex,
          progressInSection: clampProgress(this.locator.progressInSection ?? 0)
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

  private renderDomSection(section: SectionDocument, renderVersion: number): void {
    if (!this.options.container || renderVersion !== this.renderVersion) {
      return;
    }

    const input = this.chapterRenderInputs[this.currentSectionIndex];
    if (!input) {
      return;
    }

    this.domChapterRenderer.render(
      this.options.container,
      this.createDomRenderInput(section, input)
    );
    this.lastInteractionRegions = [];
    this.lastVisibleBounds = [];
    this.lastRenderedSectionIds = [section.id];
    this.lastRenderMetrics = {
      backend: "dom",
      visibleSectionCount: 1,
      visibleDrawOpCount: 0,
      highlightedDrawOpCount: 0,
      totalCanvasHeight: this.options.container.scrollHeight
    };
  }

  private syncDomSectionStateAfterRender(
    renderBehavior: RenderBehavior,
    preservedScrollAnchor: ScrollAnchor | null
  ): void {
    if (!this.options.container) {
      return;
    }

    if (this.mode === "scroll") {
      if (renderBehavior === "preserve" && preservedScrollAnchor) {
        this.options.container.scrollTop = preservedScrollAnchor.fallbackScrollTop;
      } else {
        this.scrollDomSectionToProgress(this.locator?.progressInSection ?? 0);
      }
    }

    this.locator = {
      ...this.locator,
      spineIndex: this.currentSectionIndex,
      progressInSection: this.locator?.progressInSection ?? 0
    };
  }

  private scrollDomSectionToProgress(progressInSection: number): void {
    if (!this.options.container) {
      return;
    }

    const section = this.options.container.querySelector(".epub-dom-section");
    const sectionHeight =
      (section instanceof HTMLElement
        ? section.scrollHeight || section.offsetHeight
        : 0) || this.options.container.scrollHeight;
    const clamped = Number.isFinite(progressInSection)
      ? Math.max(0, Math.min(progressInSection, 1))
      : 0;
    const availableScroll = Math.max(
      0,
      sectionHeight - this.options.container.clientHeight
    );
    this.options.container.scrollTop = availableScroll * clamped;
  }

  private resolveChapterRenderDecision(sectionIndex: number): ChapterRenderDecision {
    const section = this.book?.sections[sectionIndex]
    if (
      section?.presentationRole === "cover" ||
      section?.presentationRole === "image-page"
    ) {
      return {
        mode: "dom",
        score: 0,
        reasons: [section.presentationRole === "cover" ? "cover-section" : "image-page-section"]
      }
    }

    const input = this.chapterRenderInputs[sectionIndex];
    if (!input) {
      return {
        mode: "canvas",
        score: 0,
        reasons: []
      };
    }

    return this.chapterRenderDecisionCache.resolve(
      {
        href: input.href,
        content: input.content
      },
      () =>
        analyzeChapterRenderMode(
          buildChapterAnalysisInput({
            href: input.href,
            chapter: input.preprocessed
          })
        )
    );
  }

  private applyContainerTheme(): void {
    if (!this.options.container) {
      return;
    }

    const profile = buildReadingStyleProfile({
      theme: this.theme,
      typography: this.typography
    });
    const variables = buildReadingStyleCssVariables(profile);
    this.options.container.style.background = this.theme.background;
    this.options.container.style.color = this.theme.color;
    this.options.container.style.fontSize = `${this.typography.fontSize}px`;
    this.options.container.style.lineHeight = String(
      this.typography.lineHeight
    );
    for (const [name, value] of Object.entries(variables)) {
      this.options.container.style.setProperty(name, value);
    }
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
      domHtml?: string;
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

      const chapterRenderDecision = this.resolveChapterRenderDecision(index);
      if (chapterRenderDecision.mode === "dom") {
        const input = this.chapterRenderInputs[index];
        const height =
          this.sectionEstimatedHeights[index] ??
          Math.max(this.getPageHeight(), this.options.container.clientHeight);
        measuredSectionHeights[index] = height;
        sectionsToRender.push({
          sectionId: section.id,
          sectionHref: section.href,
          height,
          ...(input
            ? {
                domHtml: this.domChapterRenderer.createMarkup(
                  this.createDomRenderInput(section, input)
                )
              }
            : {})
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
        resolveImageUrl: (src) => this.resolveCanvasResourceUrl(src),
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
    for (let index = 0; index < this.book.sections.length; index += 1) {
      const section = this.book.sections[index];
      if (!section) {
        continue;
      }
      this.sectionEstimatedHeights[index] = this.getSectionHeight(section.id);
    }
    this.lastInteractionRegions = this.offsetInteractionRegionsForScroll(result.sections);
    this.lastVisibleBounds = this.collectVisibleBoundsForScroll(sectionsToRender);
    this.lastRenderedSectionIds = sectionsToRender.map((entry) => entry.sectionId);
    const highlightedDrawOpCount = sectionsToRender
      .flatMap((entry) => entry.displayList?.ops ?? [])
      .filter((op) => op.kind === "text" && Boolean(op.highlightColor)).length;
    const currentDecision = this.resolveChapterRenderDecision(this.currentSectionIndex);
    this.lastRenderMetrics = {
      backend: currentDecision.mode,
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
              this.sumPretextLineHeights(slice.block.lines, slice.lineStart, slice.lineEnd) +
              (slice.lineEnd === slice.block.lines.length
                ? this.getPretextBlockTrailingSpace(slice.block)
                : 0)
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
      resolveImageUrl: (src) => this.resolveCanvasResourceUrl(src),
      highlightedBlockIds: this.highlightedBlockIds,
      activeBlockId: this.locator?.blockId
    });
  }

  private sumPretextLineHeights(
    lines: Array<{ height: number }>,
    start = 0,
    end = lines.length
  ): number {
    let total = 0
    for (let index = start; index < end; index += 1) {
      total += lines[index]?.height ?? 0
    }
    return total
  }

  private getPretextBlockTrailingSpace(block: LayoutPretextBlock): number {
    return Math.max(
      0,
      block.estimatedHeight - this.sumPretextLineHeights(block.lines)
    )
  }

  private findPretextLineBreak(
    lines: Array<{ height: number }>,
    start: number,
    availableHeight: number
  ): number {
    if (availableHeight <= 0) {
      return start
    }

    let totalHeight = 0
    let index = start
    while (index < lines.length) {
      const lineHeight = lines[index]?.height ?? 0
      if (totalHeight > 0 && totalHeight + lineHeight > availableHeight) {
        break
      }
      totalHeight += lineHeight
      index += 1
      if (totalHeight >= availableHeight) {
        break
      }
    }

    return index
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
    return collectBlockText(block);
  }

  private extractInlineText(inlines: InlineNode[]): string {
    return inlines.map((inline) => collectInlineText(inline)).join("");
  }

  private resolveCanvasResourceUrl(path: string): string {
    return this.resolveRenderableResourceUrl(path, "canvas");
  }

  private resolveDomResourceUrl(path: string): string {
    return this.resolveRenderableResourceUrl(path, "dom");
  }

  private resolveRenderableResourceUrl(
    path: string,
    consumer: ResourceConsumer
  ): string {
    if (
      !this.resources ||
      typeof Blob === "undefined" ||
      typeof URL === "undefined"
    ) {
      return path;
    }

    this.trackRenderableResourceConsumer(path, consumer);
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
        const consumers = this.pendingResourceConsumers.get(path);
        if (consumers?.has("dom")) {
          this.patchRenderedDomResource(path, objectUrl);
        }
        if (consumers?.has("canvas")) {
          this.scheduleDeferredResourceRenderRefresh();
        }
        this.pendingResourceConsumers.delete(path);
      })
      .catch(() => {
        // Keep the original path when the resource cannot be resolved.
        this.pendingResourceConsumers.delete(path);
      });

    this.objectUrls.set(path, placeholder);
    return placeholder;
  }

  private resolveDomAttributeValue(
    sectionHref: string,
    tagName: string,
    attributeName: string,
    value: string
  ): string {
    const normalizedTagName = tagName.toLowerCase();
    const normalizedAttributeName = attributeName.toLowerCase();

    if (normalizedAttributeName === "style") {
      return this.resolveDomStyleAttributeValue(sectionHref, value)
    }

    if (
      !this.shouldResolveDomResourceAttribute(
        normalizedTagName,
        normalizedAttributeName
      )
    ) {
      return value;
    }

    if (
      value.startsWith("data:") ||
      value.startsWith("blob:") ||
      value.startsWith("//") ||
      /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)
    ) {
      return value;
    }

    return this.resolveDomResourceUrl(resolveResourcePath(sectionHref, value));
  }

  private createDomRenderInput(
    section: SectionDocument,
    input: SharedChapterRenderInput
  ): DomChapterRenderInput {
    const renderInput: DomChapterRenderInput = {
      sectionId: section.id,
      sectionHref: section.href,
      ...(section.presentationRole ? { presentationRole: section.presentationRole } : {}),
      linkedStyleSheets: (input.linkedStyleSheets ?? []).map((stylesheet) => ({
        href: stylesheet.href,
        text: this.resolveDomStyleSheetText(stylesheet.href, stylesheet.text)
      })),
      nodes: input.preprocessed.nodes,
      theme: this.theme,
      typography: this.typography,
      fontFamily: this.getFontFamily(),
      resolveAttributeValue: ({ tagName, attributeName, value }) =>
        this.resolveDomAttributeValue(section.href, tagName, attributeName, value)
    }

    const presentationImage = this.resolvePresentationSectionImage(section)
    if (presentationImage) {
      return {
        ...renderInput,
        presentationImageSrc: this.resolveDomResourceUrl(presentationImage.src),
        ...(presentationImage.alt ? { presentationImageAlt: presentationImage.alt } : {})
      }
    }

    return renderInput
  }

  private resolvePresentationSectionImage(
    section: SectionDocument
  ): { src: string; alt?: string } | null {
    if (section.presentationRole === "cover") {
      const coverImageHref = this.book?.metadata.coverImageHref
      if (coverImageHref) {
        return {
          src: coverImageHref,
          ...(this.book?.metadata.title ? { alt: this.book.metadata.title } : {})
        }
      }
    }

    if (section.presentationRole === "cover" || section.presentationRole === "image-page") {
      const sectionImage = this.extractSingleSectionImage(section)
      if (sectionImage) {
        return sectionImage
      }
    }

    return null
  }

  private extractSingleSectionImage(
    section: SectionDocument
  ): { src: string; alt?: string } | null {
    if (section.blocks.length !== 1) {
      return null
    }

    const [block] = section.blocks
    if (!block) {
      return null
    }

    if (block.kind === "image") {
      return {
        src: block.src,
        ...(block.alt ? { alt: block.alt } : {})
      }
    }

    if (
      block.kind === "text" &&
      block.inlines.length === 1 &&
      block.inlines[0]?.kind === "image"
    ) {
      const image = block.inlines[0]
      return {
        src: image.src,
        ...(image.alt ? { alt: image.alt } : {})
      }
    }

    return null
  }

  private shouldResolveDomResourceAttribute(
    tagName: string,
    attributeName: string
  ): boolean {
    if (
      attributeName === "src" &&
      (tagName === "img" || tagName === "source")
    ) {
      return true
    }

    if (
      (attributeName === "href" || attributeName === "xlink:href") &&
      (tagName === "image" || tagName === "use")
    ) {
      return true
    }

    return false
  }

  private resolveDomStyleAttributeValue(sectionHref: string, value: string): string {
    return this.resolveDomCssUrlValues(sectionHref, value)
  }

  private resolveDomStyleSheetText(sectionHref: string, value: string): string {
    return this.resolveDomCssUrlValues(sectionHref, value)
  }

  private resolveDomCssUrlValues(sectionHref: string, value: string): string {
    return value.replace(
      /url\(\s*(['"]?)([^)"']+)\1\s*\)/gi,
      (match, quote: string, path: string) => {
        if (
          !path ||
          path.startsWith("data:") ||
          path.startsWith("blob:") ||
          path.startsWith("//") ||
          /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(path)
        ) {
          return match
        }

        const resolved = this.resolveDomResourceUrl(resolveResourcePath(sectionHref, path))
        const wrappedQuote = quote || '"'
        return `url(${wrappedQuote}${resolved}${wrappedQuote})`
      }
    )
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
    this.pendingResourceConsumers.clear();
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
      if (target instanceof HTMLElement && target.closest(".epub-dom-section")) {
        this.handleDomClick(event);
        return;
      }

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

  private handleDomClick(event: MouseEvent): void {
    if (!this.options.container || !this.book) {
      return;
    }

    if (hasActiveTextSelection()) {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const link = target.closest("a[href]");
    if (link instanceof HTMLAnchorElement) {
      const href = link.getAttribute("href");
      if (!href) {
        return;
      }

      event.preventDefault();
      void this.goToHref(href);
      return;
    }

    const sectionElement = target.closest(".epub-dom-section");
    if (!(sectionElement instanceof HTMLElement)) {
      return;
    }

    const sectionId = sectionElement.dataset.sectionId;
    const sectionIndex = sectionId
      ? this.book.sections.findIndex((section) => section.id === sectionId)
      : this.currentSectionIndex;
    if (sectionIndex < 0) {
      return;
    }

    const sectionHeight = Math.max(1, sectionElement.scrollHeight || sectionElement.offsetHeight || 1);
    const clickY = event.clientY - sectionElement.getBoundingClientRect().top;
    const progress = Math.max(0, Math.min(clickY / sectionHeight, 1));

    this.currentSectionIndex = sectionIndex;
    this.locator = {
      spineIndex: sectionIndex,
      progressInSection: progress
    };
    this.syncCurrentPageFromSection();
    this.events.emit("relocated", { locator: this.locator });
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
            let lineEnd = this.findPretextLineBreak(layoutBlock.lines, lineStart, remainingHeight)

            if (lineEnd === lineStart && currentPage.blocks.length > 0) {
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
              lineEnd = this.findPretextLineBreak(layoutBlock.lines, lineStart, pageHeight)
            }

            if (lineEnd === lineStart) {
              lineEnd = Math.min(layoutBlock.lines.length, lineStart + 1)
            }

            currentPage.blocks.push({
              type: "pretext",
              block: layoutBlock,
              lineStart,
              lineEnd
            });
            usedHeight += this.sumPretextLineHeights(layoutBlock.lines, lineStart, lineEnd);
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

          usedHeight += this.getPretextBlockTrailingSpace(layoutBlock);
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

    const progress = this.locator?.progressInSection ?? 0;
    if (this.currentSectionIndex === 0 && progress <= 0) {
      this.isProgrammaticScroll = true;
      this.options.container.scrollTop = 0;
      return;
    }

    const sectionTop = this.getSectionTop(section.id);
    const sectionHeight = this.getSectionHeight(section.id);
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

  private findRenderedSectionIndexForOffset(offset: number): number {
    const book = this.book
    const container = this.options.container
    if (!container || !book) {
      return -1
    }

    const renderedSections = Array.from(
      container.querySelectorAll<HTMLElement>("article[data-section-id]")
    )
      .map((element) => {
        const sectionId = element.dataset.sectionId
        if (!sectionId) {
          return null
        }

        const sectionIndex = book.sections.findIndex(
          (section) => section.id === sectionId
        )
        if (sectionIndex < 0) {
          return null
        }

        const height = getRenderedSectionHeight(element)
        if (height <= 0) {
          return null
        }

        return {
          sectionIndex,
          top: element.offsetTop,
          height
        }
      })
      .filter(
        (
          entry
        ): entry is {
          sectionIndex: number
          top: number
          height: number
        } => entry !== null
      )
      .sort((left, right) => left.top - right.top)

    if (renderedSections.length === 0) {
      return -1
    }

    const firstSection = renderedSections[0]
    if (firstSection && offset < firstSection.top) {
      return firstSection.sectionIndex
    }

    for (let index = 0; index < renderedSections.length; index += 1) {
      const entry = renderedSections[index]
      if (!entry) {
        continue
      }
      const next = renderedSections[index + 1] ?? null
      if (offset < entry.top + entry.height) {
        return entry.sectionIndex
      }
      if (next && offset < next.top) {
        return entry.sectionIndex
      }
    }

    return renderedSections[renderedSections.length - 1]?.sectionIndex ?? -1
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
      const sectionIndex = this.book.sections.findIndex((section) => section.id === sectionId);
      if (
        sectionIndex >= 0 &&
        this.resolveChapterRenderDecision(sectionIndex).mode === "dom"
      ) {
        continue;
      }
      if (!window || window.length === 0) {
        this.rerenderScrollSlicesPreservingScrollTop();
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
        this.rerenderScrollSlicesPreservingScrollTop();
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

  private rerenderScrollSlicesPreservingScrollTop(): void {
    if (!this.options.container) {
      return;
    }

    const scrollAnchor = this.captureScrollAnchor();
    const preservedScrollTop = this.options.container.scrollTop;
    const preservedScrollLeft = this.options.container.scrollLeft;
    this.isProgrammaticScroll = true;
    this.renderScrollableCanvas(this.renderVersion);
    if (scrollAnchor) {
      this.restoreScrollAnchor(scrollAnchor);
    } else {
      this.options.container.scrollTop = preservedScrollTop;
    }
    this.options.container.scrollLeft = preservedScrollLeft;
  }

  private scheduleDeferredResourceRenderRefresh(): void {
    if (!this.book || !this.options.container) {
      return;
    }

    if (this.resourceRenderRefreshTimer !== null) {
      return;
    }

    this.resourceRenderRefreshTimer = setTimeout(() => {
      this.resourceRenderRefreshTimer = null;
      this.renderCurrentSection("preserve");
    }, 48);
  }

  private clearDeferredResourceRenderRefresh(): void {
    if (this.resourceRenderRefreshTimer !== null) {
      clearTimeout(this.resourceRenderRefreshTimer);
      this.resourceRenderRefreshTimer = null;
    }
  }

  private captureScrollAnchor(): ScrollAnchor | null {
    if (!this.options.container || !this.book) {
      return null;
    }

    const scrollTop = this.options.container.scrollTop;
    const renderedSections = Array.from(
      this.options.container.querySelectorAll<HTMLElement>(
        "article[data-section-id]:not(.epub-section-virtual)"
      )
    )
      .map((element) => {
        const sectionId = element.dataset.sectionId;
        if (!sectionId) {
          return null;
        }

        const height = getRenderedSectionHeight(element);
        if (height <= 0) {
          return null;
        }

        return {
          sectionId,
          top: element.offsetTop,
          height
        };
      })
      .filter(
        (
          entry
        ): entry is {
          sectionId: string;
          top: number;
          height: number;
        } => entry !== null
      )
      .sort((left, right) => left.top - right.top);

    const renderedMatch =
      renderedSections.find(
        (entry) => scrollTop >= entry.top && scrollTop < entry.top + entry.height
      ) ?? null;

    if (renderedMatch) {
      return {
        sectionId: renderedMatch.sectionId,
        offsetWithinSection: Math.max(0, scrollTop - renderedMatch.top),
        fallbackScrollTop: scrollTop
      };
    }

    return {
      sectionId: "",
      offsetWithinSection: 0,
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

  private trackRenderableResourceConsumer(
    path: string,
    consumer: ResourceConsumer
  ): void {
    const consumers = this.pendingResourceConsumers.get(path) ?? new Set<ResourceConsumer>();
    consumers.add(consumer);
    this.pendingResourceConsumers.set(path, consumers);
  }

  private patchRenderedDomResource(path: string, objectUrl: string): boolean {
    if (!this.options.container) {
      return false;
    }

    const candidates = this.options.container.querySelectorAll<HTMLElement>(
      ".epub-dom-section img, .epub-dom-section source, .epub-dom-section image, .epub-dom-section use, .epub-dom-section [style*='url('], style[data-epub-dom-source]"
    );
    let patched = false;

    for (const element of candidates) {
      if (element.tagName.toLowerCase() === "style") {
        if (element.textContent?.includes(path)) {
          element.textContent = element.textContent.replaceAll(path, objectUrl)
          patched = true
        }
        continue
      }

      if (element.getAttribute("src") === path) {
        element.setAttribute("src", objectUrl);
        patched = true;
      }

      if (element.getAttribute("href") === path) {
        element.setAttribute("href", objectUrl);
        patched = true;
      }

      if (element.getAttribute("xlink:href") === path) {
        element.setAttribute("xlink:href", objectUrl);
        patched = true;
      }

      const style = element.getAttribute("style")
      if (style?.includes(path)) {
        element.setAttribute("style", style.replaceAll(path, objectUrl))
        patched = true;
      }
    }

    return patched;
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
    if (sectionElement) {
      const domSection = sectionElement.querySelector<HTMLElement>(".epub-dom-section");
      if (domSection) {
        const domHeight = domSection.scrollHeight || domSection.offsetHeight;
        if (domHeight > 0) {
          return domHeight;
        }
      }
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
    const renderedSectionIndex = this.findRenderedSectionIndexForOffset(offset)
    if (renderedSectionIndex >= 0) {
      return renderedSectionIndex
    }

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

function hasActiveTextSelection(): boolean {
  if (typeof window === "undefined" || typeof window.getSelection !== "function") {
    return false;
  }

  const selection = window.getSelection();
  return Boolean(selection && selection.toString().trim());
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(value, 1));
}

function getRenderedSectionHeight(element: HTMLElement): number {
  const domSection = element.querySelector<HTMLElement>(".epub-dom-section");
  if (domSection) {
    return Math.max(
      domSection.scrollHeight || 0,
      domSection.offsetHeight || 0,
      element.offsetHeight || 0
    );
  }

  return element.offsetHeight || 0;
}
