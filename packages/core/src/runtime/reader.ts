import EventEmitter from "eventemitter3";
import {
  LayoutEngine,
  type LayoutResult
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
import {
  createBlockLocator,
  findRenderedAnchorTarget,
  resolveBookHrefLocator
} from "./navigation-target";
import {
  mapDomLocatorToViewport,
  mapDomPointToLocator
} from "./dom-viewport-mapper";
import { resolveDomClickInteraction } from "./dom-interaction-model";
import { findRenderedSearchResultTarget } from "./dom-search-result-target";
import { resolveRenderBackendCapabilities } from "./render-backend-capabilities";
import { buildSearchResultsForSection } from "./search-results";
import {
  buildPageDisplayList,
  buildPaginatedPages,
  type ReaderPage
} from "./paginated-render-plan";
import { buildScrollRenderPlan } from "./scroll-render-plan";
import { createDomChapterRenderInput } from "./dom-render-input-factory";
import {
  RenderableResourceManager,
  type RenderableResourceConsumer
} from "./renderable-resource-manager";
import { ScrollCoordinator } from "./scroll-coordinator";

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
  private readonly domChapterRenderer = new DomChapterRenderer();
  private readonly chapterRenderDecisionCache = new ChapterRenderDecisionCache();
  private readonly scrollCoordinator: ScrollCoordinator;
  private readonly renderableResourceManager: RenderableResourceManager;

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
  private resizeObserver: ResizeObserver | null = null;
  private lastMeasuredWidth = 0;
  private pages: ReaderPage[] = [];
  private currentPageNumber = 1;
  private sectionEstimatedHeights: number[] = [];
  private scrollWindowStart = -1;
  private scrollWindowEnd = -1;
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
    this.scrollCoordinator = new ScrollCoordinator({
      container: this.options.container,
      onScrollFrame: (emitEvent) => {
        this.syncPositionFromScroll(emitEvent);
        const refreshedWindow = this.refreshScrollWindowIfNeeded();
        if (!refreshedWindow) {
          this.refreshScrollSlicesIfNeeded();
        }
      },
      onDeferredScrollRefresh: () => {
        this.refreshScrollWindowIfNeeded();
      },
      onDeferredResourceRenderRefresh: () => {
        this.renderCurrentSection("preserve");
      },
      onDeferredAnchorRealignment: () => {
        this.currentSectionIndex = this.locator?.spineIndex ?? this.currentSectionIndex;
        if (!this.scrollToLocatorAnchor()) {
          return;
        }
        this.syncCurrentPageFromSection();
        this.locator = {
          ...this.locator,
          spineIndex: this.currentSectionIndex,
          progressInSection: this.getProgressForCurrentLocator()
        };
      }
    });
    this.renderableResourceManager = new RenderableResourceManager({
      getContainer: () => this.options.container,
      readBinary: (path) => this.resources?.readBinary(path) ?? null,
      shouldTrackDomLayoutChanges: () => Boolean(this.locator?.anchorId),
      onCanvasResourceResolved: () => {
        this.scheduleDeferredResourceRenderRefresh();
      },
      onDomLayoutChange: () => {
        this.scheduleDeferredAnchorRealignment();
      }
    });
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
    this.lastChapterRenderDecision = null;
    this.scrollCoordinator.reset();
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

    const results: SearchResult[] = [];
    this.highlightedBlockIds.clear();

    for (let index = 0; index < this.book.sections.length; index += 1) {
      const section = this.book.sections[index];
      if (!section) {
        continue;
      }

      const sectionResults = buildSearchResultsForSection({
        section,
        spineIndex: index,
        query
      });
      for (const result of sectionResults) {
        results.push(result);
        if (result.locator.blockId) {
          this.highlightedBlockIds.add(result.locator.blockId);
        }
      }
    }

    this.renderCurrentSection("preserve");
    this.events.emit("searchCompleted", { query, results });
    return results;
  }

  async goToSearchResult(result: SearchResult): Promise<void> {
    await this.goToLocation(result.locator);
    this.realignDomSearchResult(result);
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
    const capabilities = resolveRenderBackendCapabilities({
      backend: this.lastChapterRenderDecision.mode,
      mode: this.mode
    });
    return {
      mode: this.lastChapterRenderDecision.mode,
      score: this.lastChapterRenderDecision.score,
      reasons: [...this.lastChapterRenderDecision.reasons],
      ...capabilities,
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
      const capabilities = resolveRenderBackendCapabilities({
        backend: decision.mode,
        mode: this.mode
      });
      diagnostics.push({
        mode: decision.mode,
        score: decision.score,
        reasons: [...decision.reasons],
        ...capabilities,
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
    const targetSection = this.book.sections[locator.spineIndex];
    if (!targetSection) {
      return [];
    }
    const targetSectionId = targetSection.id;

    const canvasRects = this.lastInteractionRegions
      .filter((region) =>
        region.sectionId === targetSectionId &&
        (targetBlockId ? region.blockId === targetBlockId : true)
      )
      .map((region) => region.rect);
    if (canvasRects.length > 0) {
      return canvasRects;
    }

    const sectionElement = this.getSectionElement(targetSectionId);
    if (!sectionElement || !isRenderedDomSectionElement(sectionElement)) {
      return [];
    }

    return mapDomLocatorToViewport({
      container: this.options.container,
      mode: this.mode,
      sectionElement,
      locator,
      sectionTop: this.getSectionTop(targetSectionId),
      sectionHeight: this.getSectionHeight(targetSectionId)
    });
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
      : this.mapDomViewportPointToLocator(point);
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
    this.scrollCoordinator.clearAll();
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
      return null
    }

    return resolveBookHrefLocator({
      book: this.book,
      currentSectionIndex: this.currentSectionIndex,
      href
    })
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
      this.ensurePages(layout);
      const currentPage = this.resolveRenderedPage(section.id);
      if (chapterRenderDecision.mode === "dom") {
        this.renderDomSection(section, renderVersion);
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
        this.syncDomSectionStateAfterRender(renderBehavior, preservedScrollAnchor);
        return;
      }
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
      if (this.locator?.anchorId && this.scrollToLocatorAnchor()) {
        this.syncCurrentPageFromSection();
        this.locator = {
          ...this.locator,
          spineIndex: this.currentSectionIndex,
          progressInSection: this.getProgressForCurrentLocator()
        };
        return;
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

    if (renderBehavior === "preserve" && preservedScrollAnchor && this.mode === "scroll") {
      this.setProgrammaticScrollTop(preservedScrollAnchor.fallbackScrollTop);
    } else if (this.scrollToLocatorAnchor()) {
      this.syncCurrentPageFromSection();
      this.locator = {
        ...this.locator,
        spineIndex: this.currentSectionIndex,
        progressInSection: this.getProgressForCurrentLocator()
      };
      return;
    } else {
      this.scrollDomSectionToProgress(this.locator?.progressInSection ?? 0);
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
    this.setProgrammaticScrollTop(availableScroll * clamped);
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
            chapter: input.preprocessed,
            stylesheets: input.linkedStyleSheets.map((stylesheet) => stylesheet.ast)
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

    const plan = buildScrollRenderPlan({
      sections: this.book.sections,
      scrollWindowStart: this.scrollWindowStart,
      scrollWindowEnd: this.scrollWindowEnd,
      sectionEstimatedHeights: this.sectionEstimatedHeights,
      viewportTop: this.options.container.scrollTop,
      viewportHeight: this.options.container.clientHeight,
      pageHeight: this.getPageHeight(),
      overscanMultiplier: EpubReader.SCROLL_SLICE_OVERSCAN_MULTIPLIER,
      lastMeasuredWidth: this.lastMeasuredWidth,
      getSectionHeight: (sectionId) => this.getSectionHeight(sectionId),
      resolveChapterRenderDecision: (index) => this.resolveChapterRenderDecision(index),
      buildDomMarkup: (section, index) => {
        const input = this.chapterRenderInputs[index]
        return input
          ? this.domChapterRenderer.createMarkup(this.createDomRenderInput(section, input))
          : undefined
      },
      buildCanvasSection: (section, index) => {
        const layout = this.layoutEngine.layout(
          {
            section,
            spineIndex: index,
            viewportWidth: this.getContentWidth(),
            viewportHeight: this.options.container!.clientHeight,
            typography: this.typography,
            fontFamily: this.getFontFamily()
          },
          "scroll"
        )
        const displayList = this.displayListBuilder.buildSection({
          section,
          width: layout.width,
          viewportHeight: this.options.container!.clientHeight,
          blocks: layout.blocks,
          theme: this.theme,
          typography: this.typography,
          locatorMap: layout.locatorMap,
          resolveImageLoaded: (src) => this.isImageResourceReady(src),
          resolveImageUrl: (src) => this.resolveCanvasResourceUrl(src),
          highlightedBlockIds: this.highlightedBlockIds,
          activeBlockId: this.locator?.blockId
        })

        return {
          width: layout.width,
          displayList,
          measuredHeight: displayList.height,
          estimatedHeight: Math.max(this.getPageHeight(), displayList.height)
        }
      }
    })
    const sectionsToRender = plan.sectionsToRender
    this.sectionEstimatedHeights = plan.sectionEstimatedHeights
    this.lastMeasuredWidth = plan.lastMeasuredWidth
    this.lastScrollRenderWindows.clear()
    for (const [sectionId, renderWindows] of plan.scrollRenderWindows.entries()) {
      this.lastScrollRenderWindows.set(sectionId, renderWindows)
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
    return buildPageDisplayList({
      page,
      section,
      width: this.getContentWidth(),
      viewportHeight: this.options.container?.clientHeight ?? 720,
      theme: this.theme,
      typography: this.typography,
      highlightedBlockIds: this.highlightedBlockIds,
      activeBlockId: this.locator?.blockId,
      resolveImageLoaded: (src) => this.isImageResourceReady(src),
      resolveImageUrl: (src) => this.resolveCanvasResourceUrl(src),
      estimateBlockHeight: (block) => this.estimateBlockHeightForPage(block),
      buildSectionDisplayList: (input) => this.displayListBuilder.buildSection(input)
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
    return this.renderableResourceManager.isReady(src);
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
    consumer: RenderableResourceConsumer
  ): string {
    return this.renderableResourceManager.resolveUrl(path, consumer);
  }

  private createDomRenderInput(
    section: SectionDocument,
    input: SharedChapterRenderInput
  ): DomChapterRenderInput {
    return createDomChapterRenderInput({
      book: this.book,
      section,
      input,
      theme: this.theme,
      typography: this.typography,
      fontFamily: this.getFontFamily(),
      resolveDomResourceUrl: (path) => this.resolveDomResourceUrl(path)
    })
  }

  private revokeObjectUrls(): void {
    this.renderableResourceManager.revokeAll();
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
      this.scrollCoordinator.handleScrollEvent(this.mode);
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

    const point = this.getContainerRelativePoint(event);
    if (!point) {
      return;
    }

    const section = this.book.sections[sectionIndex];
    if (!section) {
      return;
    }

    const interaction = resolveDomClickInteraction({
      target,
      resolveLocator: () =>
        mapDomPointToLocator({
          container: this.options.container!,
          sectionElement,
          section,
          spineIndex: sectionIndex,
          point
        })
    });
    if (!interaction) {
      return;
    }

    if (interaction.kind === "link") {
      event.preventDefault();
      void this.goToHref(interaction.href);
      return;
    }

    this.currentSectionIndex = interaction.locator.spineIndex;
    this.locator = interaction.locator;
    this.syncCurrentPageFromSection();
    this.events.emit("relocated", { locator: this.locator });
  }

  private mapDomViewportPointToLocator(point: Point): Locator | null {
    if (!this.book || !this.options.container) {
      return null;
    }

    const sectionEntry = this.findRenderedDomSectionAtPoint(point);
    if (!sectionEntry) {
      return null;
    }

    return mapDomPointToLocator({
      container: this.options.container,
      sectionElement: sectionEntry.sectionElement,
      section: sectionEntry.section,
      spineIndex: sectionEntry.sectionIndex,
      point
    });
  }

  private getContainerRelativePoint(event: MouseEvent): Point | null {
    if (!this.options.container) {
      return null;
    }

    const bounds = this.options.container.getBoundingClientRect();
    return {
      x: event.clientX - bounds.left + this.options.container.scrollLeft,
      y: event.clientY - bounds.top
    };
  }

  private realignDomSearchResult(result: SearchResult): void {
    if (!this.options.container || !this.book) {
      return;
    }

    const section = this.book.sections[this.currentSectionIndex];
    if (!section) {
      return;
    }

    const sectionElement = this.getSectionElement(section.id);
    if (!sectionElement || !isRenderedDomSectionElement(sectionElement)) {
      return;
    }

    const target = findRenderedSearchResultTarget({
      sectionElement,
      result
    });
    if (!target) {
      return;
    }

    const containerRect = this.options.container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const nextScrollTop =
      this.options.container.scrollTop + targetRect.top - containerRect.top - 16;
    this.setProgrammaticScrollTop(nextScrollTop);

    const containerWidth = this.options.container.clientWidth || Math.max(1, containerRect.width);
    const containerHeight =
      this.options.container.clientHeight || Math.max(1, containerRect.height);
    const targetPoint = {
      x: Math.max(
        0,
        Math.min(
          targetRect.left - containerRect.left + Math.max(1, Math.min(12, targetRect.width / 2)),
          containerWidth - 1
        )
      ),
      y: Math.max(
        0,
        Math.min(
          targetRect.top - containerRect.top + Math.max(1, Math.min(12, targetRect.height / 2)),
          containerHeight - 1
        )
      )
    };
    const preciseLocator = this.mapDomViewportPointToLocator(targetPoint);
    if (!preciseLocator) {
      return;
    }

    this.currentSectionIndex = preciseLocator.spineIndex;
    this.locator = {
      ...result.locator,
      ...preciseLocator,
      ...(preciseLocator.blockId ?? result.locator.blockId
        ? { blockId: preciseLocator.blockId ?? result.locator.blockId }
        : {}),
      ...(preciseLocator.anchorId ?? result.locator.anchorId
        ? { anchorId: preciseLocator.anchorId ?? result.locator.anchorId }
        : {})
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
    sectionLayout?: LayoutResult
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
    const plan = buildPaginatedPages({
      sections: this.book.sections,
      currentSectionIndex: this.currentSectionIndex,
      sectionLayout,
      pageHeight,
      getSectionLayout: (section, index) =>
        this.layoutEngine.layout(
          {
            section,
            spineIndex: index,
            viewportWidth: targetWidth,
            viewportHeight: this.options.container!.clientHeight,
            typography: this.typography,
            fontFamily: this.getFontFamily()
          },
          "paginated"
        )
    })

    this.sectionEstimatedHeights = plan.sectionEstimatedHeights
    this.pages = plan.pages
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

  private scrollToLocatorBlock(): boolean {
    if (!this.options.container || !this.locator?.blockId) {
      return false;
    }

    const blockRegion = this.lastInteractionRegions.find(
      (region) =>
        region.kind === "block" &&
        region.blockId === this.locator?.blockId &&
        region.sectionId === this.book?.sections[this.currentSectionIndex]?.id
    );
    if (!blockRegion) {
      return false;
    }
    this.setProgrammaticScrollTop(Math.max(0, blockRegion.rect.y - 16));
    return true;
  }

  private scrollToLocatorAnchor(): boolean {
    if (!this.options.container || !this.locator?.anchorId) {
      return false;
    }

    const section = this.book?.sections[this.currentSectionIndex];
    const sectionElement = section ? this.getSectionElement(section.id) : null;
    if (!sectionElement) {
      return false;
    }

    const target = findRenderedAnchorTarget(sectionElement, this.locator.anchorId);
    if (!target) {
      return false;
    }

    const containerRect = this.options.container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const nextScrollTop =
      this.options.container.scrollTop + targetRect.top - containerRect.top - 16;
    this.setProgrammaticScrollTop(nextScrollTop);
    return true;
  }

  private scrollToCurrentLocation(): void {
    if (!this.options.container) {
      return;
    }

    if (this.scrollToLocatorAnchor()) {
      return;
    }

    if (this.locator?.blockId && this.scrollToLocatorBlock()) {
      return;
    }

    const section = this.book?.sections[this.currentSectionIndex];
    if (!section) {
      this.setProgrammaticScrollTop(0);
      return;
    }

    const progress = this.locator?.progressInSection ?? 0;
    if (this.currentSectionIndex === 0 && progress <= 0) {
      this.setProgrammaticScrollTop(0);
      return;
    }

    const sectionTop = this.getSectionTop(section.id);
    const sectionHeight = this.getSectionHeight(section.id);
    const targetTop =
      sectionTop +
      Math.max(0, Math.min(progress, 1)) *
        Math.max(0, sectionHeight - this.options.container.clientHeight);
    this.setProgrammaticScrollTop(Math.max(0, targetTop));
  }

  private syncPositionFromScroll(emitEvent: boolean): boolean {
    if (!this.options.container || !this.book || this.mode !== "scroll") {
      return false;
    }

    const preservedBlockId = emitEvent ? undefined : this.locator?.blockId;
    const preservedAnchorId = emitEvent ? undefined : this.locator?.anchorId;
    if (!emitEvent && this.locator?.anchorId) {
      this.currentSectionIndex = this.locator.spineIndex;
      this.syncCurrentPageFromSection();
      this.locator = {
        ...this.locator,
        spineIndex: this.currentSectionIndex,
        progressInSection: this.getProgressForCurrentLocator()
      };
      return true;
    }

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
      ...(preservedAnchorId ? { anchorId: preservedAnchorId } : {}),
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
    this.scrollCoordinator.scheduleDeferredScrollRefresh(this.mode);
  }

  private clearDeferredScrollRefresh(): void {
    this.scrollCoordinator.clearDeferredScrollRefresh();
  }

  private rerenderScrollSlicesPreservingScrollTop(): void {
    if (!this.options.container) {
      return;
    }

    const scrollAnchor = this.captureScrollAnchor();
    const preservedScrollTop = this.options.container.scrollTop;
    const preservedScrollLeft = this.options.container.scrollLeft;
    this.renderScrollableCanvas(this.renderVersion);
    if (scrollAnchor) {
      this.restoreScrollAnchor(scrollAnchor);
    } else {
      this.setProgrammaticScrollTop(preservedScrollTop);
    }
    this.options.container.scrollLeft = preservedScrollLeft;
  }

  private scheduleDeferredResourceRenderRefresh(): void {
    if (!this.book || !this.options.container) {
      return;
    }

    this.scrollCoordinator.scheduleDeferredResourceRenderRefresh();
  }

  private clearDeferredResourceRenderRefresh(): void {
    this.scrollCoordinator.clearDeferredResourceRenderRefresh();
  }

  private scheduleDeferredAnchorRealignment(): void {
    if (!this.options.container || !this.locator?.anchorId) {
      return;
    }

    this.scrollCoordinator.scheduleDeferredAnchorRealignment();
  }

  private clearDeferredAnchorRealignment(): void {
    this.scrollCoordinator.clearDeferredAnchorRealignment();
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

    if (!anchor || !anchor.sectionId) {
      this.setProgrammaticScrollTop(
        anchor?.fallbackScrollTop ?? this.options.container.scrollTop
      );
      return;
    }

    const sectionTop = this.getSectionTop(anchor.sectionId);
    this.setProgrammaticScrollTop(Math.max(
      0,
      sectionTop + anchor.offsetWithinSection
    ));
  }

  private setProgrammaticScrollTop(nextScrollTop: number): void {
    this.scrollCoordinator.setProgrammaticScrollTop(nextScrollTop);
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

    return (
      this.options.container.querySelector<HTMLElement>(
        `article[data-section-id="${sectionId}"]`
      ) ??
      this.options.container.querySelector<HTMLElement>(
        `.epub-dom-section[data-section-id="${sectionId}"]`
      )
    );
  }

  private findRenderedDomSectionAtPoint(point: Point): {
    section: SectionDocument;
    sectionIndex: number;
    sectionElement: HTMLElement;
  } | null {
    if (!this.book || !this.options.container) {
      return null;
    }

    const candidateSectionIds = this.lastRenderedSectionIds.length
      ? this.lastRenderedSectionIds
      : this.book.sections[this.currentSectionIndex]?.id
        ? [this.book.sections[this.currentSectionIndex]!.id]
        : [];

    if (this.mode === "paginated") {
      for (const sectionId of candidateSectionIds) {
        const sectionIndex = this.book.sections.findIndex((section) => section.id === sectionId);
        if (sectionIndex < 0) {
          continue;
        }

        const section = this.book.sections[sectionIndex];
        const sectionElement = this.getSectionElement(sectionId);
        if (!section || !sectionElement || !isRenderedDomSectionElement(sectionElement)) {
          continue;
        }

        return {
          section,
          sectionIndex,
          sectionElement
        };
      }

      return null;
    }

    const absoluteY = point.y + this.options.container.scrollTop;
    for (const sectionId of candidateSectionIds) {
      const sectionIndex = this.book.sections.findIndex((section) => section.id === sectionId);
      if (sectionIndex < 0) {
        continue;
      }

      const section = this.book.sections[sectionIndex];
      const sectionElement = this.getSectionElement(sectionId);
      if (!section || !sectionElement || !isRenderedDomSectionElement(sectionElement)) {
        continue;
      }

      const top = this.getSectionTop(sectionId);
      const height = this.getSectionHeight(sectionId);
      if (absoluteY >= top && absoluteY <= top + height) {
        return {
          section,
          sectionIndex,
          sectionElement
        };
      }
    }

    return null;
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

function isRenderedDomSectionElement(element: HTMLElement): boolean {
  return element.matches(".epub-dom-section") || Boolean(element.querySelector(".epub-dom-section"))
}
