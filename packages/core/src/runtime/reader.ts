import EventEmitter from "eventemitter3";
import { LayoutEngine, type LayoutResult } from "../layout/layout-engine";
import { CanvasRenderer } from "../renderer/canvas-renderer";
import { DisplayListBuilder } from "../renderer/display-list-builder";
import {
  DomChapterRenderer,
  serializeDomPageViewportAttributes,
  type DomChapterRenderInput
} from "../renderer/dom-chapter-renderer";
import {
  DEFAULT_READER_BASELINE_STYLE_PROFILE,
  buildReadingStyleCssVariables,
  buildReadingStyleProfile
} from "../renderer/reading-style-profile";
import { BookParser } from "../parser/book-parser";
import {
  normalizeEpubInput,
  type EpubInput
} from "../container/normalize-input";
import type {
  Annotation,
  AnnotationViewportSnapshot,
  Bookmark,
  BlockNode,
  Book,
  ChapterRenderDecision,
  Decoration,
  HitTestResult,
  InlineNode,
  Locator,
  LocatorRestoreDiagnostics,
  PageSpreadPlacement,
  Point,
  PublisherStylesMode,
  PublicationAccessibilitySnapshot,
  ReadingMode,
  RenderMetrics,
  RenderDiagnostics,
  ReaderEvent,
  ReaderEventMap,
  ReadingLanguageContext,
  ReadingNavigationContext,
  ReadingProgressSnapshot,
  ReadingSpreadContext,
  ReaderOptions,
  ReaderPreferences,
  ReaderSelectionHighlightState,
  ReaderSettings,
  ReaderSpreadMode,
  ReaderTextSelectionSnapshot,
  Rect,
  SectionAccessibilitySnapshot,
  SectionDocument,
  SerializedLocator,
  SearchResult,
  SectionRenderedEvent,
  SectionRelocatedEvent,
  TextRangeSelector,
  Theme,
  TocTarget,
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
import {
  extractIntrinsicImageSize,
  type IntrinsicImageSize
} from "../utils/image-intrinsic-size";
import { buildChapterAnalysisInput } from "./chapter-analysis-input";
import { analyzeChapterRenderMode } from "./chapter-render-analyzer";
import { ChapterRenderDecisionCache } from "./chapter-render-decision-cache";
import { ReaderInteractionController } from "./reader-interaction-controller";
import { ReaderNavigationController } from "./reader-navigation-controller";
import { ReaderRenderOrchestrator } from "./reader-render-orchestrator";
import {
  createSharedChapterRenderInput,
  type SharedChapterRenderInput
} from "./chapter-render-input";
import {
  createBlockLocator,
  flattenTocTargets,
  findRenderedAnchorTarget,
  resolveBookHrefLocator
} from "./navigation-target";
import { normalizeLocator, restoreLocatorWithDiagnostics } from "./locator";
import {
  createBookmark as createReaderBookmark,
  derivePublicationId
} from "./bookmark";
import {
  createAnnotation as createReaderAnnotation,
  mapAnnotationsToDecorations
} from "./annotation";
import {
  DEFAULT_READER_SETTINGS,
  deserializeReaderPreferences,
  mergeReaderPreferences,
  normalizeReaderPreferences,
  resolveReaderSettings,
  serializeReaderPreferences
} from "./preferences";
import {
  collectBlockIdsInReadingOrder,
  normalizeTextRangeSelector,
  toTransparentHighlightColor
} from "./reader-domain";
import { stripPublisherStylesFromSection } from "./publisher-styles";
import {
  resolveReadingLanguageContext,
  resolveReadingNavigationContext
} from "./reading-language";
import {
  resolveReadingSpreadContext,
  resolveSyntheticSpreadViewportPartition
} from "./reading-spread";
import {
  buildPublicationAccessibilitySnapshot,
  buildSectionAccessibilitySnapshot
} from "./accessibility";
import { DecorationManager } from "./decoration-manager";
import { applyDomDecorations } from "./dom-decoration";
import {
  findDomHitTargetAtPoint,
  mapDomLocatorToViewport,
  mapDomTextRangeToViewport,
  mapDomPointToLocator
} from "./dom-viewport-mapper";
import { classifyNavigationHref } from "./external-boundary";
import { resolveDomClickInteraction } from "./dom-interaction-model";
import { findRenderedSearchResultTarget } from "./dom-search-result-target";
import { resolveRenderBackendCapabilities } from "./render-backend-capabilities";
import { buildSearchResultsForSection } from "./search-results";
import {
  buildPageDisplayList,
  buildPaginatedPages,
  type PageBlockSlice,
  type ReaderPage
} from "./paginated-render-plan";
import { buildScrollRenderPlan } from "./scroll-render-plan";
import {
  createDomChapterRenderInput,
  resolveFixedLayoutFrame
} from "./dom-render-input-factory";
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

type PaginatedSpreadSlot = {
  position: PageSpreadPlacement;
  page: ReaderPage | null;
  section: SectionDocument | null;
  isBlank: boolean;
};

type PaginatedSpread = {
  anchorPageNumber: number;
  pageNumbers: number[];
  currentPageNumber: number;
  slots: PaginatedSpreadSlot[];
};

type ReaderTextSelection = Omit<
  ReaderTextSelectionSnapshot,
  "rects" | "visible"
>;

export class EpubReader {
  private readonly parser = new BookParser();
  private readonly events = new EventEmitter<ReaderEventMap>();
  private readonly layoutEngine = new LayoutEngine();
  private readonly displayListBuilder = new DisplayListBuilder();
  private readonly canvasRenderer = new CanvasRenderer();
  private readonly domChapterRenderer = new DomChapterRenderer();
  private readonly chapterRenderDecisionCache =
    new ChapterRenderDecisionCache();
  private readonly scrollCoordinator: ScrollCoordinator;
  private readonly renderableResourceManager: RenderableResourceManager;
  private readonly decorationManager = new DecorationManager();
  private readonly interactionController: ReaderInteractionController;
  private readonly navigationController: ReaderNavigationController;
  private readonly renderOrchestrator: ReaderRenderOrchestrator;

  private book: Book | null = null;
  private sourceName: string | null = null;
  private annotations: Annotation[] = [];
  private resources: {
    readBinary(path: string): Promise<Uint8Array>;
    exists(path: string): boolean;
  } | null = null;
  private chapterRenderInputs: SharedChapterRenderInput[] = [];
  private locator: Locator | null = null;
  private sectionIndexById = new Map<string, number>();
  private preferences: ReaderPreferences;
  private mode: "scroll" | "paginated";
  private publisherStyles: PublisherStylesMode;
  private experimentalRtl: boolean;
  private spreadMode: ReaderSpreadMode;
  private debugMode = false;
  private theme: Theme;
  private typography: TypographyOptions;
  private currentSectionIndex = 0;
  private resizeObserver: ResizeObserver | null = null;
  private lastMeasuredWidth = 0;
  private lastMeasuredHeight = 0;
  private pages: ReaderPage[] = [];
  private currentPageNumber = 1;
  private sectionEstimatedHeights: number[] = [];
  private scrollWindowStart = -1;
  private scrollWindowEnd = -1;
  private lastVisibleBounds: VisibleDrawBounds = [];
  private lastInteractionRegions: InteractionRegion[] = [];
  private lastRenderedSectionIds: string[] = [];
  private lastScrollRenderWindows = new Map<
    string,
    Array<{ top: number; height: number }>
  >();
  private lastRenderMetrics: RenderMetrics = {
    backend: "canvas",
    visibleSectionCount: 0,
    visibleDrawOpCount: 0,
    highlightedDrawOpCount: 0,
    totalCanvasHeight: 0
  };
  private renderVersion = 0;
  private lastChapterRenderDecision: ChapterRenderDecision | null = null;
  private readonly imageIntrinsicSizeCache = new Map<
    string,
    IntrinsicImageSize | null
  >();
  private readonly pendingImageIntrinsicSizePaths = new Set<string>();
  private lastLocatorRestoreDiagnostics: LocatorRestoreDiagnostics | null =
    null;
  private lastFixedLayoutRenderSignature: string | null = null;
  private lastPresentationRenderSignature: string | null = null;
  private textSelectionSnapshot: ReaderTextSelectionSnapshot | null = null;
  private pinnedTextSelectionSnapshot: ReaderTextSelectionSnapshot | null =
    null;
  private readonly handleDocumentSelectionChange = (): void => {
    this.syncTextSelectionState();
  };

  private static readonly SCROLL_WINDOW_RADIUS = 1;
  private static readonly SCROLL_SLICE_OVERSCAN_MULTIPLIER = 0.75;
  private static readonly PAGINATED_CLICK_NAV_ZONE_RATIO = 0.28;

  constructor(private readonly options: ReaderOptions = {}) {
    this.preferences = mergeReaderPreferences(
      {
        ...(options.mode ? { mode: options.mode } : {}),
        ...(options.theme ? { theme: options.theme } : {}),
        ...(options.typography ? { typography: options.typography } : {})
      },
      options.preferences
    );
    const settings = resolveReaderSettings(
      this.preferences,
      DEFAULT_READER_SETTINGS
    );
    this.mode = settings.mode;
    this.publisherStyles = settings.publisherStyles;
    this.experimentalRtl = settings.experimentalRtl;
    this.spreadMode = settings.spreadMode;
    this.theme = { ...settings.theme };
    this.typography = { ...settings.typography };
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
        this.currentSectionIndex =
          this.locator?.spineIndex ?? this.currentSectionIndex;
        if (!this.scrollToLocatorAnchor()) {
          return;
        }
        this.syncCurrentPageFromSection();
        this.updateLocator({
          ...this.locator,
          spineIndex: this.currentSectionIndex,
          progressInSection: this.getProgressForCurrentLocator()
        });
      }
    });
    this.renderableResourceManager = new RenderableResourceManager({
      getContainer: () => this.options.container,
      readBinary: (path) => this.resources?.readBinary(path) ?? null,
      hasBinary: (path) => this.resources?.exists(path) ?? null,
      shouldTrackDomLayoutChanges: () =>
        this.lastChapterRenderDecision?.mode === "dom" &&
        (this.mode === "paginated" || Boolean(this.locator?.anchorId)),
      onCanvasResourceResolved: () => {
        this.scheduleDeferredResourceRenderRefresh();
      },
      onDomLayoutChange: () => {
        if (
          this.mode === "paginated" &&
          this.lastChapterRenderDecision?.mode === "dom"
        ) {
          this.scheduleDeferredResourceRenderRefresh();
          return;
        }
        this.scheduleDeferredAnchorRealignment();
      }
    });
    this.interactionController = new ReaderInteractionController({
      getContainer: () => this.options.container,
      getMode: () => this.mode,
      getBook: () => this.book,
      handleScrollEvent: (mode) => this.scrollCoordinator.handleScrollEvent(mode),
      hasTextSelectionSnapshot: () => Boolean(this.textSelectionSnapshot),
      syncTextSelectionState: () => this.syncTextSelectionState(),
      hasActiveTextSelection: (scope) => hasActiveTextSelection(scope),
      handleDomClick: (event) => this.handleDomClick(event),
      getContainerRelativePoint: (event) => this.getContainerRelativePoint(event),
      resolveAnnotationSelectionAtPoint: (point) =>
        this.resolveAnnotationSelectionAtPoint(point),
      setPinnedTextSelectionSnapshot: (snapshot) =>
        this.setPinnedTextSelectionSnapshot(snapshot),
      hasPinnedTextSelectionSnapshot: () =>
        Boolean(this.pinnedTextSelectionSnapshot),
      hitTest: (point) => this.hitTest(point),
      resolvePaginatedClickNavigationAction: (input) =>
        this.resolvePaginatedClickNavigationAction(input),
      performPaginatedNavigationAction: (action) =>
        this.performPaginatedNavigationAction(action),
      emitPaginatedCenterTapped: (input) => this.emitPaginatedCenterTapped(input),
      mapDomViewportPointToLocator: (point) =>
        this.mapDomViewportPointToLocator(point),
      getCurrentLocation: () => this.getCurrentLocation(),
      activateLink: (input) => this.activateLink(input),
      updateLocator: (locator) => this.updateLocator(locator),
      setCurrentSectionIndex: (sectionIndex) => {
        this.currentSectionIndex = sectionIndex;
      },
      syncCurrentPageFromSection: () => this.syncCurrentPageFromSection(),
      emitRelocated: () => this.emitRelocated(),
      isEditableTarget: (target) => isEditableTarget(target),
      getReadingNavigationContext: () => this.getReadingNavigationContext(),
      next: () => this.next(),
      prev: () => this.prev()
    });
    this.navigationController = new ReaderNavigationController({
      getBook: () => this.book,
      getMode: () => this.mode,
      getCurrentSectionIndex: () => this.currentSectionIndex,
      setCurrentSectionIndex: (sectionIndex) => {
        this.currentSectionIndex = sectionIndex;
      },
      getLocator: () => this.locator,
      updateLocator: (locator) => this.updateLocator(locator),
      ensurePages: () => this.ensurePages(),
      findPageForLocator: (locator) => this.findPageForLocator(locator),
      resolveDisplayPageNumberToLeafPage: (pageNumber) =>
        this.resolveDisplayPageNumberToLeafPage(pageNumber),
      findPageByNumber: (pageNumber) => this.findPageByNumber(pageNumber),
      createLocatorForPage: (page) =>
        this.createLocatorForPage(page as unknown as ReaderPage),
      renderCurrentSection: () => this.renderCurrentSection(),
      emitRelocated: () => this.emitRelocated(),
      setCurrentPageNumber: (pageNumber) => {
        this.currentPageNumber = pageNumber;
      },
      getCurrentPageNumber: () => this.currentPageNumber,
      getPageCount: () => this.pages.length,
      getPaginationInfo: () => this.getPaginationInfo(),
      getCurrentLocation: () => this.getCurrentLocation(),
      getPublicationId: () => this.getPublicationId(),
      setLastLocatorRestoreDiagnostics: (diagnostics) => {
        this.lastLocatorRestoreDiagnostics = diagnostics;
      },
      getProgressForCurrentLocator: () => this.getProgressForCurrentLocator(),
      getSectionProgressWeights: () => this.getSectionProgressWeights(),
      getPageHeight: () => this.getPageHeight()
    });
    this.renderOrchestrator = new ReaderRenderOrchestrator({
      getBook: () => this.book,
      getContainer: () => this.options.container,
      getMode: () => this.mode,
      getCurrentSectionIndex: () => this.currentSectionIndex,
      setCurrentSectionIndex: (sectionIndex) => {
        this.currentSectionIndex = sectionIndex;
      },
      getSectionForRender: (section) => this.getSectionForRender(section),
      captureScrollAnchor: () => this.captureScrollAnchor(),
      setLastPresentationRenderSignature: (signature) => {
        this.lastPresentationRenderSignature = signature;
      },
      resolvePresentationRenderSignature: (section) =>
        this.resolvePresentationRenderSignature(section),
      resolveChapterRenderDecision: (sectionIndex) =>
        this.resolveChapterRenderDecision(sectionIndex),
      setLastChapterRenderDecision: (decision) => {
        this.lastChapterRenderDecision = decision;
      },
      applyContainerTheme: () => this.applyContainerTheme(),
      getPublisherStyles: () => this.publisherStyles,
      syncFixedLayoutContainerState: (value) =>
        this.syncFixedLayoutContainerState(
          value as DomChapterRenderInput | null
        ),
      nextRenderVersion: () => ++this.renderVersion,
      getPaginationMeasurement: () => this.getPaginationMeasurement(),
      layoutPaginatedSection: (section, spineIndex, measurement) =>
        this.layoutEngine.layout(
          {
            section,
            spineIndex,
            viewportWidth: measurement.width,
            viewportHeight: measurement.height,
            typography: this.typography,
            fontFamily: this.getFontFamily(),
            resolveImageIntrinsicSize: (src) =>
              this.resolveImageIntrinsicSizeForLayout(src)
          },
          this.mode
        ),
      setMeasuredSize: (size) => {
        this.lastMeasuredWidth = size.width;
        this.lastMeasuredHeight = size.height;
      },
      ensurePages: (layout) => this.ensurePages(layout),
      resolveRenderedPage: (sectionId) => this.resolveRenderedPage(sectionId),
      renderPaginatedDomSpread: (page, renderVersion) =>
        this.renderPaginatedDomSpread(
          page as unknown as ReaderPage,
          renderVersion
        ),
      renderDomSection: (section, renderVersion) =>
        this.renderDomSection(section, renderVersion),
      syncMeasuredPaginatedDomPages: (section) =>
        this.syncMeasuredPaginatedDomPages(section),
      setCurrentPageNumber: (pageNumber) => {
        this.currentPageNumber = pageNumber;
      },
      getLocator: () => this.locator,
      updateLocator: (locator) => this.updateLocator(locator),
      syncDomSectionStateAfterRender: (
        renderBehavior,
        preservedScrollAnchor,
        resolvedPage
      ) =>
        this.syncDomSectionStateAfterRender(
          renderBehavior,
          preservedScrollAnchor as ScrollAnchor | null,
          resolvedPage as ReaderPage | null
        ),
      renderPaginatedCanvas: (section, currentPage, renderVersion) =>
        this.renderPaginatedCanvas(
          section,
          currentPage as ReaderPage | null,
          renderVersion
        ),
      getContentWidth: () => this.getContentWidth(),
      getContainerClientHeight: () => this.options.container?.clientHeight ?? 0,
      updateScrollWindowBounds: () => this.updateScrollWindowBounds(),
      renderScrollableCanvas: (renderVersion) =>
        this.renderScrollableCanvas(renderVersion),
      scrollToCurrentLocation: () => this.scrollToCurrentLocation(),
      restoreScrollAnchor: (anchor) =>
        this.restoreScrollAnchor(anchor as ScrollAnchor | null),
      scrollToLocatorAnchor: () => this.scrollToLocatorAnchor(),
      syncCurrentPageFromSection: () => this.syncCurrentPageFromSection(),
      getProgressForCurrentLocator: () => this.getProgressForCurrentLocator(),
      clampProgress: (value) => clampProgress(value),
      syncPositionFromScroll: (emitEvent) => this.syncPositionFromScroll(emitEvent),
      emitSectionRendered: (section) => this.emitSectionRendered(section)
    });
    this.attachResizeObserver();
    this.attachScrollListener();
    this.attachPointerListener();
    this.attachKeyboardListener();
    this.attachSelectionChangeListener();
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
    this.layoutEngine.clearCache();
    this.book = parsed.book;
    this.rebuildSectionIndex();
    this.sourceName = normalized.sourceName ?? null;
    this.resources = parsed.resources;
    this.imageIntrinsicSizeCache.clear();
    this.pendingImageIntrinsicSizePaths.clear();
    this.annotations = [];
    this.revokeObjectUrls();
    this.chapterRenderInputs = parsed.sectionContents.map((entry) =>
      createSharedChapterRenderInput(entry)
    );
    const startLocator = parsed.book.metadata.startHref
      ? resolveBookHrefLocator({
          book: parsed.book,
          currentSectionIndex: 0,
          href: parsed.book.metadata.startHref
        })
      : null;
    this.locator = startLocator;
    this.currentSectionIndex = startLocator?.spineIndex ?? 0;
    this.pages = [];
    this.sectionEstimatedHeights = [];
    this.currentPageNumber = 1;
    this.lastMeasuredWidth = 0;
    this.lastMeasuredHeight = 0;
    this.lastPresentationRenderSignature = null;
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
    this.lastLocatorRestoreDiagnostics = null;
    this.lastFixedLayoutRenderSignature = null;
    this.updateTextSelectionSnapshot(null);
    this.decorationManager.clearAll();
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

    if (this.mode === "scroll") {
      await this.goToScrollSection(this.currentSectionIndex + 2);
      return;
    }

    this.ensurePages();
    const spreadTargetPage =
      this.mode === "paginated"
        ? this.resolveSpreadNavigationTarget("next")
        : null;
    if (typeof spreadTargetPage === "number") {
      await this.goToLeafPage(spreadTargetPage);
      return;
    }
    const nextPage = Math.min(
      this.currentPageNumber + 1,
      this.pages.length || 1
    );
    await this.goToLeafPage(nextPage);
  }

  async prev(): Promise<void> {
    if (!this.book) {
      return;
    }

    if (this.mode === "scroll") {
      await this.goToScrollSection(this.currentSectionIndex);
      return;
    }

    this.ensurePages();
    const spreadTargetPage =
      this.mode === "paginated"
        ? this.resolveSpreadNavigationTarget("previous")
        : null;
    if (typeof spreadTargetPage === "number") {
      await this.goToLeafPage(spreadTargetPage);
      return;
    }
    const previousPage = Math.max(this.currentPageNumber - 1, 1);
    await this.goToLeafPage(previousPage);
  }

  async goToLocation(locator: Locator): Promise<void> {
    await this.navigationController.goToLocation(locator);
  }

  async restoreLocation(
    locator: Locator | SerializedLocator
  ): Promise<boolean> {
    return this.navigationController.restoreLocation(locator);
  }

  async restoreBookmark(bookmark: Bookmark): Promise<boolean> {
    return this.navigationController.restoreBookmark(bookmark);
  }

  async goToTocItem(id: string): Promise<void> {
    await this.navigationController.goToTocItem(id);
  }

  async setTheme(theme: Partial<Theme>): Promise<void> {
    await this.submitPreferences({
      theme
    });
  }

  async setTypography(options: Partial<TypographyOptions>): Promise<void> {
    await this.submitPreferences({
      typography: options
    });
  }

  async setMode(mode: "scroll" | "paginated"): Promise<void> {
    await this.submitPreferences({
      mode
    });
  }

  async submitPreferences(
    preferences: ReaderPreferences
  ): Promise<ReaderSettings> {
    return this.applyPreferences(
      mergeReaderPreferences(this.preferences, preferences)
    );
  }

  async restorePreferences(
    preferences: ReaderPreferences | string | null | undefined
  ): Promise<ReaderSettings> {
    if (typeof preferences === "string") {
      const restored = deserializeReaderPreferences(preferences);
      return restored ? this.applyPreferences(restored) : this.getSettings();
    }

    return this.applyPreferences(normalizeReaderPreferences(preferences));
  }

  serializePreferences(): string {
    return serializeReaderPreferences(this.preferences);
  }

  async goToPage(pageNumber: number): Promise<void> {
    await this.navigationController.goToPage(pageNumber);
  }

  private async goToScrollSection(sectionNumber: number): Promise<void> {
    await this.navigationController.goToScrollSection(sectionNumber);
  }

  private async goToLeafPage(pageNumber: number): Promise<void> {
    await this.navigationController.goToLeafPage(pageNumber);
  }

  async search(query: string): Promise<SearchResult[]> {
    if (!this.book || !query.trim()) {
      this.decorationManager.clearExplicitGroup("search-results");
      if (this.book) {
        this.renderCurrentSection("preserve");
      }
      return [];
    }

    const results: SearchResult[] = [];
    const searchDecorations: Decoration[] = [];

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
        searchDecorations.push({
          id: `search:${result.sectionId}:${searchDecorations.length + 1}`,
          group: "search-results",
          locator: result.locator,
          style: "search-hit"
        });
      }
    }

    this.decorationManager.setExplicitGroup(
      "search-results",
      searchDecorations
    );
    this.renderCurrentSection("preserve");
    this.events.emit("searchCompleted", { query, results });
    return results;
  }

  async goToSearchResult(result: SearchResult): Promise<void> {
    await this.goToLocation(result.locator);
    this.realignDomSearchResult(result);
  }

  getCurrentLocation(): Locator | null {
    return this.locator ? normalizeLocator(this.locator) : null;
  }

  getReadingProgress(): ReadingProgressSnapshot | null {
    return this.navigationController.getReadingProgress();
  }

  async goToProgress(progress: number): Promise<Locator | null> {
    return this.navigationController.goToProgress(progress);
  }

  setDecorations(input: { group: string; decorations: Decoration[] }): void {
    this.decorationManager.setExplicitGroup(input.group, input.decorations);
    if (this.book) {
      this.renderCurrentSection("preserve");
    }
  }

  clearDecorations(group?: string): void {
    if (group) {
      this.decorationManager.clearExplicitGroup(group);
    } else {
      this.decorationManager.clearAllExplicit();
    }

    if (this.book) {
      this.renderCurrentSection("preserve");
    }
  }

  getDecorations(group?: string): Decoration[] {
    return group
      ? this.decorationManager.getGroup(group)
      : this.decorationManager.getAll();
  }

  setDebugMode(enabled: boolean): void {
    const nextDebugMode = Boolean(enabled);
    if (this.debugMode === nextDebugMode) {
      return;
    }

    this.debugMode = nextDebugMode;
    this.syncDerivedDecorationGroups();
    if (this.book) {
      this.renderCurrentSection("preserve");
    }
  }

  createAnnotation(
    input: {
      locator?: Locator;
      textRange?: TextRangeSelector;
      quote?: string;
      note?: string;
      color?: string;
    } = {}
  ): Annotation | null {
    if (!this.book) {
      return null;
    }

    const publicationId = this.getPublicationId();
    const locator = input.locator ?? this.getCurrentLocation();
    if (!publicationId || !locator) {
      return null;
    }
    const quote = input.quote ?? this.resolveAnnotationQuote(locator);

    return createReaderAnnotation({
      publicationId,
      locator,
      book: this.book,
      ...(input.textRange ? { textRange: input.textRange } : {}),
      ...(quote ? { quote } : {}),
      ...(input.note ? { note: input.note } : {}),
      ...(input.color ? { color: input.color } : {})
    });
  }

  createAnnotationFromSelection(
    input: {
      note?: string;
      color?: string;
    } = {}
  ): Annotation | null {
    const selection = this.getCurrentTextSelectionSnapshot();
    if (!selection) {
      return null;
    }

    return this.createAnnotation({
      locator: selection.locator,
      quote: selection.text,
      ...(selection.textRange ? { textRange: selection.textRange } : {}),
      ...(input.note ? { note: input.note } : {}),
      ...(input.color ? { color: input.color } : {})
    });
  }

  getCurrentTextSelection(): ReaderTextSelection | null {
    const selection = this.getCurrentTextSelectionSnapshot();
    if (!selection) {
      return null;
    }

    return {
      text: selection.text,
      locator: { ...selection.locator },
      sectionId: selection.sectionId,
      ...(selection.blockId ? { blockId: selection.blockId } : {})
    };
  }

  getCurrentTextSelectionSnapshot(): ReaderTextSelectionSnapshot | null {
    const selection = this.resolveCurrentTextSelectionSnapshot();
    this.updateTextSelectionSnapshot(selection);
    return cloneReaderTextSelectionSnapshot(selection);
  }

  getCurrentSelectionHighlightState(): ReaderSelectionHighlightState | null {
    const selection = this.getCurrentTextSelectionSnapshot();
    if (!selection) {
      return null;
    }

    return this.resolveSelectionHighlightState(selection);
  }

  applyCurrentSelectionHighlightAction(
    input: {
      note?: string;
      color?: string;
    } = {}
  ): {
    mode: "highlight" | "remove-highlight";
    changedCount: number;
  } | null {
    if (!this.book) {
      return null;
    }

    const selection = this.getCurrentTextSelectionSnapshot();
    if (!selection) {
      return null;
    }

    const state = this.resolveSelectionHighlightState(selection);
    if (!selection.textRange) {
      if (state.mode !== "highlight") {
        return {
          mode: state.mode,
          changedCount: 0
        };
      }

      const annotation = this.createAnnotation({
        locator: selection.locator,
        quote: selection.text,
        ...(input.note ? { note: input.note } : {}),
        ...(input.color ? { color: input.color } : {})
      });
      if (!annotation) {
        return {
          mode: state.mode,
          changedCount: 0
        };
      }

      this.addAnnotation(annotation);
      return {
        mode: state.mode,
        changedCount: 1
      };
    }

    const section = this.book.sections[selection.locator.spineIndex];
    if (!section) {
      return null;
    }

    const context = this.createSectionTextRangeContext(section);
    const selectionRange = this.normalizeTextRangeForSection(
      selection.locator.spineIndex,
      selection.textRange
    );
    if (!selectionRange) {
      return null;
    }

    if (state.mode === "remove-highlight") {
      const matchingAnnotations = this.resolveAnnotationRangesForSection(
        selection.locator.spineIndex
      );
      const nextAnnotations: Annotation[] = [];
      let changedCount = 0;

      for (const annotation of this.annotations) {
        const resolved = matchingAnnotations.find(
          (entry) => entry.annotation.id === annotation.id
        );
        if (!resolved) {
          nextAnnotations.push(annotation);
          continue;
        }

        const flattenedAnnotation = flattenTextRange(resolved.range, context);
        const flattenedSelection = flattenTextRange(selectionRange, context);
        if (!flattenedAnnotation || !flattenedSelection) {
          nextAnnotations.push(annotation);
          continue;
        }

        const remaining = subtractFlattenedRange(
          flattenedAnnotation,
          flattenedSelection
        );
        if (
          remaining.length === 1 &&
          remaining[0]!.start === flattenedAnnotation.start &&
          remaining[0]!.end === flattenedAnnotation.end
        ) {
          nextAnnotations.push(annotation);
          continue;
        }

        changedCount += 1;
        for (const piece of remaining) {
          const range = inflateFlattenedTextRange(piece, context);
          if (!range) {
            continue;
          }

          const rebuilt = this.createAnnotationForResolvedRange({
            annotation,
            locator: resolved.locator,
            range,
            section,
            ...(annotation.color ? { color: annotation.color } : {}),
            ...(annotation.note ? { note: annotation.note } : {})
          });
          if (rebuilt) {
            nextAnnotations.push(rebuilt);
          }
        }
      }

      this.setAnnotations(nextAnnotations);
      return {
        mode: state.mode,
        changedCount
      };
    }

    const flattenedSelection = flattenTextRange(selectionRange, context);
    if (!flattenedSelection) {
      return null;
    }

    let remainingRanges = [flattenedSelection];
    for (const resolved of this.resolveAnnotationRangesForSection(
      selection.locator.spineIndex
    )) {
      const flattened = flattenTextRange(resolved.range, context);
      if (!flattened) {
        continue;
      }

      remainingRanges = remainingRanges.flatMap((range) =>
        subtractFlattenedRange(range, flattened)
      );
      if (remainingRanges.length === 0) {
        break;
      }
    }

    const addedAnnotations = remainingRanges
      .map((range) => inflateFlattenedTextRange(range, context))
      .flatMap((range) => {
        if (!range) {
          return [];
        }

        const annotation = this.createAnnotationForResolvedRange({
          locator: selection.locator,
          range,
          section,
          ...(input.color ? { color: input.color } : {}),
          ...(input.note ? { note: input.note } : {})
        });
        return annotation ? [annotation] : [];
      });

    for (const annotation of addedAnnotations) {
      this.addAnnotation(annotation);
    }

    return {
      mode: state.mode,
      changedCount: addedAnnotations.length
    };
  }

  clearCurrentTextSelection(): void {
    if (
      typeof window !== "undefined" &&
      typeof window.getSelection === "function"
    ) {
      window.getSelection()?.removeAllRanges();
    }
    this.pinnedTextSelectionSnapshot = null;
    this.updateTextSelectionSnapshot(null);
  }

  addAnnotation(annotation: Annotation): void {
    const publicationId = this.getPublicationId();
    if (!publicationId || annotation.publicationId !== publicationId) {
      return;
    }

    this.annotations = [...this.annotations, annotation];
    this.syncAnnotationDecorations();
  }

  setAnnotations(annotations: Annotation[]): void {
    const publicationId = this.getPublicationId();
    this.annotations = publicationId
      ? annotations.filter(
          (annotation) => annotation.publicationId === publicationId
        )
      : [];
    this.syncAnnotationDecorations();
  }

  getAnnotations(): Annotation[] {
    return this.annotations.map((annotation) => ({
      ...annotation,
      locator: { ...annotation.locator }
    }));
  }

  getAnnotationViewportSnapshots(): AnnotationViewportSnapshot[] {
    const book = this.book;
    if (!book) {
      return [];
    }

    return this.annotations.map((annotation) => {
      const restored = restoreLocatorWithDiagnostics({
        book,
        locator: annotation.locator
      }).locator;
      const rects = restored
        ? this.resolveAnnotationViewportRects(annotation, restored)
        : [];

      return {
        annotation: {
          ...annotation,
          locator: { ...annotation.locator }
        },
        resolvedLocator: restored ? { ...restored } : null,
        rects,
        visible: rects.length > 0
      };
    });
  }

  clearAnnotations(): void {
    this.annotations = [];
    this.syncAnnotationDecorations();
  }

  private updateLocator(locator: Locator | null): void {
    this.locator = locator ? normalizeLocator(locator) : null;
    this.syncDerivedDecorationGroups();
  }

  private hitTestDom(point: Point): HitTestResult | null {
    if (!this.book || !this.options.container) {
      return null;
    }

    const sectionEntry = this.findRenderedDomSectionAtPoint(point);
    if (!sectionEntry) {
      return null;
    }

    const hitTarget = findDomHitTargetAtPoint({
      container: this.options.container,
      sectionElement: sectionEntry.sectionElement,
      point
    });
    const locator = mapDomPointToLocator({
      container: this.options.container,
      sectionElement: sectionEntry.sectionElement,
      section: sectionEntry.section,
      spineIndex: sectionEntry.sectionIndex,
      point
    });
    const normalizedLocator = normalizeLocator(locator);
    const blockId = normalizedLocator.blockId ?? sectionEntry.section.id;
    const link = hitTarget?.target.closest("a[href]");
    if (link instanceof HTMLAnchorElement && hitTarget) {
      return {
        kind: "link",
        rect: hitTarget.rect,
        sectionId: sectionEntry.section.id,
        blockId,
        href: link.getAttribute("href")?.trim() ?? "",
        locator: normalizedLocator,
        text: link.textContent?.trim() || undefined
      };
    }

    const image =
      hitTarget?.target.tagName.toLowerCase() === "img" ||
      hitTarget?.target.tagName.toLowerCase() === "image"
        ? hitTarget.target
        : hitTarget?.target.closest("img, image");
    if (image instanceof HTMLElement) {
      const imageRect =
        hitTarget?.target === image
          ? hitTarget.rect
          : {
              ...hitTarget!.rect
            };
      const src =
        image.getAttribute("src")?.trim() ??
        image.getAttribute("xlink:href")?.trim() ??
        image.getAttribute("href")?.trim() ??
        "";
      return {
        kind: "image",
        rect: imageRect,
        sectionId: sectionEntry.section.id,
        blockId,
        src,
        alt: image.getAttribute("alt")?.trim() || undefined,
        locator: normalizedLocator
      };
    }

    if (!hitTarget) {
      return null;
    }

    return {
      kind: "block",
      rect: hitTarget.rect,
      sectionId: sectionEntry.section.id,
      blockId,
      locator: normalizedLocator,
      text: hitTarget.target.textContent?.trim() || undefined
    };
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

    if (hit) {
      return hit;
    }

    return this.hitTestDom(point);
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
    const spreadContext = this.getReadingSpreadContext();
    return {
      mode: this.lastChapterRenderDecision.mode,
      score: this.lastChapterRenderDecision.score,
      reasons: [...this.lastChapterRenderDecision.reasons],
      ...(section?.renditionLayout
        ? { renditionLayout: section.renditionLayout }
        : {}),
      ...(spreadContext
        ? {
            renditionSpread: spreadContext.renditionSpread,
            spreadMode: spreadContext.spreadMode,
            pageSpreadPlacement: spreadContext.pageSpreadPlacement,
            syntheticSpreadActive: spreadContext.syntheticSpreadActive,
            viewportSlotCount: spreadContext.viewportSlotCount
          }
        : {}),
      publisherStyles: this.publisherStyles,
      ...capabilities,
      alignmentTarget: "dom-baseline",
      styleProfile: DEFAULT_READER_BASELINE_STYLE_PROFILE,
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
      const sectionIndex = this.getSectionIndexById(sectionId);
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
      const spreadContext =
        this.resolveReadingSpreadContextForSectionIndex(sectionIndex);
      diagnostics.push({
        mode: decision.mode,
        score: decision.score,
        reasons: [...decision.reasons],
        ...(section.renditionLayout
          ? { renditionLayout: section.renditionLayout }
          : {}),
        ...(spreadContext
          ? {
              renditionSpread: spreadContext.renditionSpread,
              spreadMode: spreadContext.spreadMode,
              pageSpreadPlacement: spreadContext.pageSpreadPlacement,
              syntheticSpreadActive: spreadContext.syntheticSpreadActive,
              viewportSlotCount: spreadContext.viewportSlotCount
            }
          : {}),
        publisherStyles: this.publisherStyles,
        ...capabilities,
        alignmentTarget: "dom-baseline",
        styleProfile: DEFAULT_READER_BASELINE_STYLE_PROFILE,
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

    const targetCanvasBlockIds = this.resolveCanvasViewportBlockIds(locator);
    const targetSection = this.book.sections[locator.spineIndex];
    if (!targetSection) {
      return [];
    }
    const targetSectionId = targetSection.id;

    const canvasRects = this.lastInteractionRegions
      .filter((region) => {
        if (region.sectionId !== targetSectionId) {
          return false;
        }

        return targetCanvasBlockIds.length === 0
          ? true
          : targetCanvasBlockIds.includes(region.blockId);
      })
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
    if (typeof document !== "undefined") {
      document.removeEventListener(
        "selectionchange",
        this.handleDocumentSelectionChange
      );
    }
    this.detachScrollListener();
    this.detachPointerListener();
    this.detachKeyboardListener();
    this.book = null;
    this.layoutEngine.clearCache();
    this.resources = null;
    this.imageIntrinsicSizeCache.clear();
    this.pendingImageIntrinsicSizePaths.clear();
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
    this.textSelectionSnapshot = null;
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

  getPublicationId(): string | null {
    if (!this.book) {
      return null;
    }

    return derivePublicationId({
      book: this.book,
      ...(this.sourceName ? { sourceName: this.sourceName } : {})
    });
  }

  createBookmark(
    input: {
      locator?: Locator;
      label?: string;
      excerpt?: string;
    } = {}
  ): Bookmark | null {
    if (!this.book) {
      return null;
    }

    const publicationId = this.getPublicationId();
    const locator = input.locator ?? this.getCurrentLocation();
    if (!publicationId || !locator) {
      return null;
    }

    return createReaderBookmark({
      publicationId,
      locator,
      book: this.book,
      ...(input.label ? { label: input.label } : {}),
      ...(input.excerpt ? { excerpt: input.excerpt } : {})
    });
  }

  getLastLocationRestoreDiagnostics(): LocatorRestoreDiagnostics | null {
    return this.lastLocatorRestoreDiagnostics
      ? { ...this.lastLocatorRestoreDiagnostics }
      : null;
  }

  getPreferences(): ReaderPreferences {
    return cloneReaderPreferences(this.preferences);
  }

  getSettings(): ReaderSettings {
    return {
      mode: this.mode,
      publisherStyles: this.publisherStyles,
      experimentalRtl: this.experimentalRtl,
      spreadMode: this.spreadMode,
      theme: { ...this.theme },
      typography: { ...this.typography }
    };
  }

  getReadingLanguageContext(): ReadingLanguageContext | null {
    return this.resolveReadingLanguageContextForSectionIndex(
      this.currentSectionIndex
    );
  }

  getReadingNavigationContext(): ReadingNavigationContext | null {
    return this.resolveReadingNavigationContextForSectionIndex(
      this.currentSectionIndex
    );
  }

  getReadingSpreadContext(): ReadingSpreadContext | null {
    return this.resolveReadingSpreadContextForSectionIndex(
      this.currentSectionIndex
    );
  }

  getTocTargets(): TocTarget[] {
    if (!this.book) {
      return [];
    }

    return flattenTocTargets(this.book);
  }

  getSectionAccessibilitySnapshot(
    spineIndex = this.currentSectionIndex
  ): SectionAccessibilitySnapshot | null {
    if (!this.book) {
      return null;
    }

    const section = this.book.sections[spineIndex];
    if (!section) {
      return null;
    }

    return buildSectionAccessibilitySnapshot({
      section,
      spineIndex
    });
  }

  getPublicationAccessibilitySnapshot(): PublicationAccessibilitySnapshot | null {
    if (!this.book) {
      return null;
    }

    const publicationId = this.getPublicationId();
    return buildPublicationAccessibilitySnapshot({
      book: this.book,
      ...(publicationId ? { publicationId } : {})
    });
  }

  getTheme(): Theme {
    return { ...this.theme };
  }

  getTypography(): TypographyOptions {
    return { ...this.typography };
  }

  getPaginationInfo(): PaginationInfo {
    if (this.mode === "scroll") {
      return {
        currentPage: Math.max(
          1,
          Math.min(
            this.currentSectionIndex + 1,
            this.book?.sections.length ?? 1
          )
        ),
        totalPages: Math.max(1, this.book?.sections.length ?? 1)
      };
    }
    this.ensurePages();
    if (this.mode === "paginated") {
      const visibleSpreads = this.getVisiblePaginatedSpreads();
      if (visibleSpreads.length > 0) {
        const currentSpreadIndex = visibleSpreads.findIndex((spread) =>
          spread.pageNumbers.includes(this.currentPageNumber)
        );
        return {
          currentPage: Math.max(
            1,
            currentSpreadIndex >= 0 ? currentSpreadIndex + 1 : 1
          ),
          totalPages: visibleSpreads.length
        };
      }
    }
    return {
      currentPage: Math.max(
        1,
        Math.min(this.currentPageNumber, this.pages.length || 1)
      ),
      totalPages: Math.max(1, this.pages.length)
    };
  }

  async goToHref(href: string): Promise<Locator | null> {
    return this.navigationController.goToHref(href);
  }

  private async activateLink(input: {
    href: string;
    source: "dom" | "canvas";
    text?: string;
    sectionId?: string;
    blockId?: string;
  }): Promise<void> {
    const resolved = classifyNavigationHref(input.href);
    if (resolved.kind === "internal") {
      await this.goToHref(input.href);
      return;
    }

    if (resolved.kind === "external-safe") {
      const payload = {
        href: input.href,
        scheme: resolved.scheme,
        source: input.source,
        ...(input.text ? { text: input.text } : {}),
        ...(input.sectionId ? { sectionId: input.sectionId } : {}),
        ...(input.blockId ? { blockId: input.blockId } : {})
      } satisfies ReaderEventMap["externalLinkActivated"];
      this.events.emit("externalLinkActivated", payload);
      await this.options.onExternalLink?.(payload);
      return;
    }

    this.events.emit("externalLinkBlocked", {
      href: input.href,
      scheme: resolved.scheme,
      reason: "unsafe-scheme"
    });
  }

  private getSectionProgressWeights(): number[] {
    if (!this.book || this.book.sections.length === 0) {
      return [];
    }

    return this.book.sections.map((section, index) =>
      Math.max(
        1,
        index === this.currentSectionIndex
          ? this.getSectionHeight(section.id)
          : (this.sectionEstimatedHeights[index] ?? this.getPageHeight())
      )
    );
  }

  resolveHrefLocator(href: string): Locator | null {
    return this.navigationController.resolveHrefLocator(href);
  }

  private async applyPreferences(
    preferences: ReaderPreferences
  ): Promise<ReaderSettings> {
    const nextPreferences = normalizeReaderPreferences(preferences);
    const previousSettings = this.getSettings();
    const nextSettings = resolveReaderSettings(
      nextPreferences,
      DEFAULT_READER_SETTINGS
    );
    const modeChanged = previousSettings.mode !== nextSettings.mode;
    const publisherStylesChanged =
      previousSettings.publisherStyles !== nextSettings.publisherStyles;
    const experimentalRtlChanged =
      previousSettings.experimentalRtl !== nextSettings.experimentalRtl;
    const spreadModeChanged =
      previousSettings.spreadMode !== nextSettings.spreadMode;
    const themeChanged = !themesEqual(
      previousSettings.theme,
      nextSettings.theme
    );
    const typographyChanged = !typographyEqual(
      previousSettings.typography,
      nextSettings.typography
    );
    const didChange =
      modeChanged ||
      publisherStylesChanged ||
      experimentalRtlChanged ||
      spreadModeChanged ||
      themeChanged ||
      typographyChanged;

    this.preferences = nextPreferences;
    this.mode = nextSettings.mode;
    this.publisherStyles = nextSettings.publisherStyles;
    this.experimentalRtl = nextSettings.experimentalRtl;
    this.spreadMode = nextSettings.spreadMode;
    this.theme = { ...nextSettings.theme };
    this.typography = { ...nextSettings.typography };
    this.applyContainerTheme();

    if (didChange) {
      await this.waitForFonts();
      this.pages = [];
      if (this.book) {
        this.renderCurrentSection(
          modeChanged || publisherStylesChanged || experimentalRtlChanged
            ? "relocate"
            : "preserve"
        );
      }
    }

    const settings = this.getSettings();
    if (didChange) {
      this.events.emit("preferencesChanged", {
        preferences: this.getPreferences(),
        settings
      });
    }
    if (themeChanged) {
      this.events.emit("themeChanged", { theme: { ...settings.theme } });
    }
    if (typographyChanged) {
      this.events.emit("typographyChanged", {
        typography: { ...settings.typography }
      });
    }
    if (modeChanged) {
      this.events.emit("rendered", { mode: settings.mode });
    }

    return settings;
  }

  private emitRelocated(): void {
    this.events.emit("relocated", { locator: this.locator });
    const event = this.buildSectionRelocatedEvent();
    if (!event) {
      return;
    }
    this.invokeReaderHook(() => this.options.onSectionRelocated?.(event));
  }

  private buildSectionRelocatedEvent(): SectionRelocatedEvent | null {
    if (!this.book || this.book.sections.length === 0) {
      return null;
    }

    const spineIndex = Math.max(
      0,
      Math.min(
        this.locator?.spineIndex ?? this.currentSectionIndex,
        this.book.sections.length - 1
      )
    );
    const section = this.book.sections[spineIndex];
    if (!section) {
      return null;
    }

    const elements = this.resolveSectionHookElements(section.id);
    return {
      spineIndex,
      sectionId: section.id,
      sectionHref: section.href,
      locator: this.getCurrentLocation(),
      mode: this.mode,
      backend: this.lastRenderMetrics.backend,
      diagnostics: this.getRenderDiagnostics(),
      ...(elements.containerElement
        ? { containerElement: elements.containerElement }
        : {}),
      ...(elements.contentElement
        ? { contentElement: elements.contentElement }
        : {})
    };
  }

  private emitSectionRendered(section: SectionDocument): void {
    const event = this.buildSectionRenderedEvent(section);
    if (!event) {
      return;
    }
    this.invokeReaderHook(() => this.options.onSectionRendered?.(event));
  }

  private buildSectionRenderedEvent(
    section: SectionDocument
  ): SectionRenderedEvent | null {
    if (!this.book) {
      return null;
    }

    const sectionIndex = this.getSectionIndexById(section.id);
    if (sectionIndex < 0) {
      return null;
    }

    const elements = this.resolveSectionHookElements(section.id);
    return {
      spineIndex: sectionIndex,
      sectionId: section.id,
      sectionHref: section.href,
      mode: this.mode,
      backend: this.lastRenderMetrics.backend,
      diagnostics: this.getRenderDiagnostics(),
      ...(elements.containerElement
        ? { containerElement: elements.containerElement }
        : {}),
      ...(elements.contentElement
        ? { contentElement: elements.contentElement }
        : {}),
      isCurrent: sectionIndex === this.currentSectionIndex
    };
  }

  private resolveSectionHookElements(sectionId: string): {
    containerElement?: HTMLElement;
    contentElement?: HTMLElement;
  } {
    const containerElement = this.getSectionElement(sectionId);
    const contentElement = containerElement?.matches(".epub-dom-section")
      ? containerElement
      : containerElement?.querySelector<HTMLElement>(".epub-dom-section");

    return {
      ...(containerElement ? { containerElement } : {}),
      ...(contentElement ? { contentElement } : {})
    };
  }

  private invokeReaderHook(
    callback: () => void | Promise<void> | undefined
  ): void {
    try {
      const result = callback();
      if (result) {
        void Promise.resolve(result).catch(() => {});
      }
    } catch {
      // Hook failures must stay isolated from the reader lifecycle.
    }
  }

  private renderCurrentSection(
    renderBehavior: RenderBehavior = "relocate"
  ): void {
    this.renderOrchestrator.renderCurrentSection(renderBehavior);
  }

  private renderDomSection(
    section: SectionDocument,
    renderVersion: number
  ): void {
    if (!this.options.container || renderVersion !== this.renderVersion) {
      return;
    }

    const input = this.chapterRenderInputs[this.currentSectionIndex];
    if (!input) {
      return;
    }

    const domRenderInput = this.createDomRenderInput(section, input);
    this.syncFixedLayoutContainerState(domRenderInput);
    this.domChapterRenderer.render(this.options.container, domRenderInput);
    const domSection =
      this.options.container.querySelector<HTMLElement>(".epub-dom-section");
    if (domSection) {
      annotateDomSectionWithBlockIds(section, domSection);
      applyDomDecorations({
        container: this.options.container,
        sectionElement: domSection,
        mode: this.mode,
        decorations: this.decorationManager.getForSpineIndex(
          this.currentSectionIndex
        )
      });
    }
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

  private renderPaginatedDomSpread(
    page: ReaderPage,
    renderVersion: number
  ): void {
    if (
      !this.options.container ||
      !this.book ||
      renderVersion !== this.renderVersion
    ) {
      return;
    }

    const spread = this.resolvePaginatedSpread(page);
    if (!spread || spread.slots.length === 0) {
      const section = this.book.sections[page.spineIndex];
      if (section) {
        this.renderDomSection(section, renderVersion);
      }
      return;
    }

    const renderedSections: Array<{
      sectionId: string;
      input: DomChapterRenderInput;
      page: ReaderPage;
      usesViewportSlice: boolean;
    }> = [];
    const pageHeight = this.getPageHeight();
    const markup = spread.slots
      .map((slot) => {
        if (!slot.section || !slot.page) {
          return `<div class="epub-dom-spread-slot epub-dom-spread-slot-${slot.position} epub-dom-spread-slot-blank" data-spread-slot="${slot.position}" aria-hidden="true"></div>`;
        }

        const input = this.chapterRenderInputs[slot.page.spineIndex];
        if (!input) {
          return `<div class="epub-dom-spread-slot epub-dom-spread-slot-${slot.position} epub-dom-spread-slot-blank" data-spread-slot="${slot.position}" aria-hidden="true"></div>`;
        }

        const domRenderInput = this.createDomRenderInput(slot.section, input);
        const usesViewportSlice =
          domRenderInput.renditionLayout !== "pre-paginated";
        renderedSections.push({
          sectionId: slot.section.id,
          input: domRenderInput,
          page: slot.page,
          usesViewportSlice
        });
        const sectionMarkup = this.domChapterRenderer.createMarkup(
          domRenderInput,
          usesViewportSlice
            ? { rootBackgroundTarget: "page-viewport" }
            : undefined
        );
        const slotMarkup = usesViewportSlice
          ? `<div${serializeDomPageViewportAttributes(domRenderInput, {
              pageHeight,
              pageNumberInSection: slot.page.pageNumberInSection
            })}>${sectionMarkup}</div>`
          : sectionMarkup;
        return `<div class="epub-dom-spread-slot epub-dom-spread-slot-${slot.position}" data-spread-slot="${slot.position}" data-page-number="${slot.page.pageNumber}">${slotMarkup}</div>`;
      })
      .join("");

    this.syncFixedLayoutContainerState(renderedSections[0]?.input ?? null);
    this.options.container.innerHTML = `<div class="epub-dom-spread" data-spread-page-start="${spread.anchorPageNumber}" data-spread-page-end="${spread.pageNumbers[spread.pageNumbers.length - 1] ?? spread.anchorPageNumber}" data-spread-size="${spread.pageNumbers.length}">${markup}</div>`;

    for (const renderedSection of renderedSections) {
      const domSection = this.options.container.querySelector<HTMLElement>(
        `.epub-dom-section[data-section-id="${renderedSection.sectionId}"]`
      );
      const sectionIndex = this.book.sections.findIndex(
        (section) => section.id === renderedSection.sectionId
      );
      if (domSection && sectionIndex >= 0) {
        const renderedPage = renderedSections.find(
          (entry) => entry.sectionId === renderedSection.sectionId
        );
        if (renderedPage?.usesViewportSlice) {
          this.positionPaginatedDomSection(domSection, renderedPage.page);
        }
        annotateDomSectionWithBlockIds(
          this.book.sections[sectionIndex]!,
          domSection
        );
        applyDomDecorations({
          container: this.options.container,
          sectionElement: domSection,
          mode: this.mode,
          decorations: this.decorationManager.getForSpineIndex(sectionIndex)
        });
      }
    }

    this.lastInteractionRegions = [];
    this.lastVisibleBounds = [];
    this.lastRenderedSectionIds = renderedSections.map(
      (entry) => entry.sectionId
    );
    this.lastRenderMetrics = {
      backend: "dom",
      visibleSectionCount: renderedSections.length,
      visibleDrawOpCount: 0,
      highlightedDrawOpCount: 0,
      totalCanvasHeight: this.options.container.scrollHeight
    };
  }

  private syncFixedLayoutContainerState(
    input: DomChapterRenderInput | null
  ): void {
    if (!this.options.container) {
      return;
    }

    if (
      input?.renditionLayout !== "pre-paginated" ||
      !input.fixedLayoutViewport
    ) {
      delete this.options.container.dataset.fixedLayoutScale;
      delete this.options.container.dataset.fixedLayoutWidth;
      delete this.options.container.dataset.fixedLayoutHeight;
      this.lastFixedLayoutRenderSignature = null;
      return;
    }

    if (typeof input.fixedLayoutScale === "number") {
      this.options.container.dataset.fixedLayoutScale =
        input.fixedLayoutScale.toFixed(4);
    } else {
      delete this.options.container.dataset.fixedLayoutScale;
    }

    if (typeof input.fixedLayoutRenderWidth === "number") {
      this.options.container.dataset.fixedLayoutWidth = String(
        input.fixedLayoutRenderWidth
      );
    } else {
      delete this.options.container.dataset.fixedLayoutWidth;
    }

    if (typeof input.fixedLayoutRenderHeight === "number") {
      this.options.container.dataset.fixedLayoutHeight = String(
        input.fixedLayoutRenderHeight
      );
    } else {
      delete this.options.container.dataset.fixedLayoutHeight;
    }

    this.lastFixedLayoutRenderSignature = `${
      input.fixedLayoutRenderWidth ?? input.fixedLayoutViewport.width
    }x${input.fixedLayoutRenderHeight ?? input.fixedLayoutViewport.height}@${
      typeof input.fixedLayoutScale === "number"
        ? input.fixedLayoutScale.toFixed(4)
        : "1.0000"
    }`;
  }

  private syncDomSectionStateAfterRender(
    renderBehavior: RenderBehavior,
    preservedScrollAnchor: ScrollAnchor | null,
    paginatedPage: ReaderPage | null = null
  ): void {
    if (!this.options.container) {
      return;
    }

    if (
      renderBehavior === "preserve" &&
      preservedScrollAnchor &&
      this.mode === "scroll"
    ) {
      this.setProgrammaticScrollTop(preservedScrollAnchor.fallbackScrollTop);
    } else if (this.mode === "paginated") {
      const targetPage =
        paginatedPage ??
        (this.locator
          ? this.findPageForLocator({
              ...this.locator,
              spineIndex: this.currentSectionIndex
            })
          : null) ??
        this.findCurrentPageForSection(
          this.book?.sections[this.currentSectionIndex]?.id ?? ""
        );
      const progressInSection =
        targetPage && targetPage.totalPagesInSection > 1
          ? (targetPage.pageNumberInSection - 1) /
            (targetPage.totalPagesInSection - 1)
          : 0;

      this.scrollDomSectionToPaginatedPage(targetPage);
      this.updateLocator({
        ...this.locator,
        spineIndex: this.currentSectionIndex,
        progressInSection
      });
      return;
    } else if (this.scrollToLocatorAnchor()) {
      this.syncCurrentPageFromSection();
      this.updateLocator({
        ...this.locator,
        spineIndex: this.currentSectionIndex,
        progressInSection: this.getProgressForCurrentLocator()
      });
      return;
    } else {
      this.scrollDomSectionToProgress(this.locator?.progressInSection ?? 0);
    }

    this.updateLocator({
      ...this.locator,
      spineIndex: this.currentSectionIndex,
      progressInSection: this.locator?.progressInSection ?? 0
    });
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

  private scrollDomSectionToPaginatedPage(page: ReaderPage | null): void {
    if (!this.options.container) {
      return;
    }

    const section =
      this.options.container.querySelector<HTMLElement>(".epub-dom-section");
    if (section && page) {
      this.positionPaginatedDomSection(section, page);
    }
    this.setProgrammaticScrollTop(0);
  }

  private positionPaginatedDomSection(
    section: HTMLElement,
    page: ReaderPage
  ): void {
    const viewport = section.closest<HTMLElement>(
      "[data-page-viewport='true']"
    );
    if (!viewport) {
      return;
    }

    const pageHeight = this.getPageHeight();
    const targetOffset =
      typeof page.offsetInSection === "number"
        ? Math.max(0, page.offsetInSection)
        : Math.max(0, page.pageNumberInSection - 1) * pageHeight;
    const nextPage = this.findPageByNumber(page.pageNumber + 1);
    const sectionHeight = Math.max(
      pageHeight,
      section.scrollHeight || section.offsetHeight || pageHeight
    );
    const visibleHeight =
      nextPage?.sectionId === page.sectionId &&
      typeof nextPage.offsetInSection === "number"
        ? Math.max(
            1,
            Math.min(pageHeight, nextPage.offsetInSection - targetOffset)
          )
        : Math.max(1, Math.min(pageHeight, sectionHeight - targetOffset));
    viewport.style.height = `${visibleHeight}px`;
    section.style.position = "relative";
    section.style.transform = `translateY(-${targetOffset}px)`;
    section.style.transformOrigin = "top left";
    section.style.willChange = "transform";
  }

  private syncMeasuredPaginatedDomPages(
    section: SectionDocument
  ): ReaderPage | null {
    if (!this.options.container) {
      return null;
    }

    if (
      section.renditionLayout === "pre-paginated" ||
      section.presentationRole === "cover" ||
      section.presentationRole === "image-page"
    ) {
      return null;
    }

    const selectorValue = escapeAttributeSelectorValue(section.id);
    const sectionElement = this.options.container.querySelector<HTMLElement>(
      `.epub-dom-section[data-section-id="${selectorValue}"]`
    );
    if (!sectionElement) {
      return null;
    }

    const previousTransform = sectionElement.style.transform;
    const previousTransformOrigin = sectionElement.style.transformOrigin;
    const previousWillChange = sectionElement.style.willChange;

    try {
      sectionElement.style.transform = "translateY(0px)";
      sectionElement.style.transformOrigin = "top left";
      sectionElement.style.willChange = "auto";

      const pageHeight = this.getPageHeight();
      const sectionHeight = Math.max(
        pageHeight,
        sectionElement.scrollHeight || sectionElement.offsetHeight || pageHeight
      );
      const pageOffsets = measurePaginatedDomPageOffsets(
        sectionElement,
        pageHeight
      );
      const pageCount = Math.max(1, pageOffsets.length);
      const seenBlockIdsByPage = Array.from(
        { length: pageCount },
        () => new Set<string>()
      );
      const pageBlocks = Array.from(
        { length: pageCount },
        () => [] as PageBlockSlice[]
      );
      const sectionRect = sectionElement.getBoundingClientRect();

      const measuredElements = Array.from(
        sectionElement.querySelectorAll<HTMLElement>("[data-reader-block-id]")
      );
      if (measuredElements.length === 0) {
        return null;
      }

      for (const element of measuredElements) {
        const blockId = element.dataset.readerBlockId?.trim();
        if (!blockId) {
          continue;
        }

        const block = findBlockById(section.blocks, blockId);
        if (!block) {
          continue;
        }

        const relativeTop = Math.max(
          0,
          element.getBoundingClientRect().top - sectionRect.top
        );
        const pageIndex = resolvePaginatedDomPageIndex(
          relativeTop,
          pageOffsets
        );
        const seenBlockIds = seenBlockIdsByPage[pageIndex];
        const blocks = pageBlocks[pageIndex];
        if (!seenBlockIds || !blocks || seenBlockIds.has(block.id)) {
          continue;
        }

        seenBlockIds.add(block.id);
        blocks.push({
          type: "native",
          block
        });
      }

      const nextPages: ReaderPage[] = [];
      const pagesBeforeSection = this.pages.filter(
        (page) => page.spineIndex < this.currentSectionIndex
      );
      const pagesAfterSection = this.pages.filter(
        (page) => page.spineIndex > this.currentSectionIndex
      );
      for (let index = 0; index < pageCount; index += 1) {
        nextPages.push({
          pageNumber: 0,
          pageNumberInSection: index + 1,
          totalPagesInSection: pageCount,
          spineIndex: this.currentSectionIndex,
          sectionId: section.id,
          sectionHref: section.href,
          offsetInSection: pageOffsets[index] ?? index * pageHeight,
          blocks: pageBlocks[index] ?? []
        });
      }

      this.pages = [
        ...pagesBeforeSection,
        ...nextPages,
        ...pagesAfterSection
      ].map((page, index) => ({
        ...page,
        pageNumber: index + 1
      }));
      this.sectionEstimatedHeights[this.currentSectionIndex] = Math.max(
        sectionHeight,
        pageCount * pageHeight
      );

      return this.locator
        ? this.findPageForLocator({
            ...this.locator,
            spineIndex: this.currentSectionIndex
          })
        : this.findCurrentPageForSection(section.id);
    } finally {
      sectionElement.style.transform = previousTransform;
      sectionElement.style.transformOrigin = previousTransformOrigin;
      sectionElement.style.willChange = previousWillChange;
    }
  }

  private resolveChapterRenderDecision(
    sectionIndex: number
  ): ChapterRenderDecision {
    const section = this.book?.sections[sectionIndex];
    if (section?.renditionLayout === "pre-paginated") {
      return {
        mode: "dom",
        score: 0,
        reasons: ["fixed-layout-section"]
      };
    }

    if (
      section?.presentationRole === "cover" ||
      section?.presentationRole === "image-page"
    ) {
      return {
        mode: "dom",
        score: 0,
        reasons: [
          section.presentationRole === "cover"
            ? "cover-section"
            : "image-page-section"
        ]
      };
    }

    const input = this.chapterRenderInputs[sectionIndex];
    if (!input) {
      return {
        mode: "canvas",
        score: 0,
        reasons: []
      };
    }

    // Cache by chapter source so repeated renders, searches, and mode switches do
    // not keep re-running the analyzer for the same section content.
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
            stylesheets: input.linkedStyleSheets.map(
              (stylesheet) => stylesheet.ast
            )
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
    const languageContext = this.getReadingLanguageContext();
    const navigationContext = this.getReadingNavigationContext();
    const spreadContext = this.getReadingSpreadContext();
    const variables = buildReadingStyleCssVariables(profile);
    this.options.container.style.background = this.theme.background;
    this.options.container.style.color = this.theme.color;
    this.options.container.style.fontSize = `${this.typography.fontSize}px`;
    this.options.container.style.fontFamily = this.typography.fontFamily ?? "";
    this.options.container.style.lineHeight = String(
      this.typography.lineHeight
    );
    this.options.container.style.letterSpacing = `${this.typography.letterSpacing ?? 0}px`;
    this.options.container.style.wordSpacing = `${this.typography.wordSpacing ?? 0}px`;
    this.options.container.dataset.baselineProfile = profile.name;
    this.options.container.dataset.experimentalRtl = this.experimentalRtl
      ? "enabled"
      : "disabled";
    this.options.container.dataset.contentDirection =
      languageContext?.contentDirection ?? "ltr";
    this.options.container.dataset.pageProgression =
      navigationContext?.pageProgression ?? "ltr";
    this.options.container.dataset.previousPageKey =
      navigationContext?.previousPageKey ?? "ArrowLeft";
    this.options.container.dataset.nextPageKey =
      navigationContext?.nextPageKey ?? "ArrowRight";
    this.options.container.dataset.spreadMode =
      spreadContext?.spreadMode ?? this.spreadMode;
    this.options.container.dataset.renditionSpread =
      spreadContext?.renditionSpread ??
      this.book?.metadata.renditionSpread ??
      "auto";
    this.options.container.dataset.syntheticSpread =
      spreadContext?.syntheticSpreadActive ? "enabled" : "disabled";
    this.options.container.dataset.pageSpreadPlacement =
      spreadContext?.pageSpreadPlacement ?? "center";
    this.options.container.dataset.viewportSlotCount = String(
      spreadContext?.viewportSlotCount ?? 1
    );
    if (languageContext?.resolvedLanguage) {
      this.options.container.dataset.contentLanguage =
        languageContext.resolvedLanguage;
      this.options.container.lang = languageContext.resolvedLanguage;
    } else {
      delete this.options.container.dataset.contentLanguage;
      this.options.container.removeAttribute("lang");
    }
    if (languageContext?.rtlActive) {
      this.options.container.dir = "rtl";
    } else {
      this.options.container.removeAttribute("dir");
    }
    for (const [name, value] of Object.entries(variables)) {
      this.options.container.style.setProperty(name, value);
    }
  }

  private renderPaginatedCanvas(
    section: SectionDocument,
    page: ReaderPage | null,
    renderVersion: number
  ): void {
    if (
      !this.options.container ||
      !page ||
      renderVersion !== this.renderVersion
    ) {
      return;
    }

    const displayList = this.buildDisplayListForPage(section, page);
    const result = this.canvasRenderer.renderPaginated(
      this.options.container,
      displayList,
      this.getPageHeight(),
      this.options.canvas
    );
    this.lastInteractionRegions = result.sections.flatMap(
      (entry) => entry.interactions
    );
    this.lastVisibleBounds = result.bounds;
    this.lastRenderedSectionIds = [section.id];
    const highlightedDrawOpCount = displayList.ops.filter(
      (op) =>
        op.kind === "text" &&
        (Boolean(op.highlightColor) || Boolean(op.highlightSegments?.length))
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
    if (
      !this.book ||
      !this.options.container ||
      renderVersion !== this.renderVersion
    ) {
      return;
    }

    const plan = buildScrollRenderPlan({
      sections: this.getSectionsForRender(),
      scrollWindowStart: this.scrollWindowStart,
      scrollWindowEnd: this.scrollWindowEnd,
      sectionEstimatedHeights: this.sectionEstimatedHeights,
      viewportTop: this.options.container.scrollTop,
      viewportHeight: this.options.container.clientHeight,
      pageHeight: this.getPageHeight(),
      overscanMultiplier: EpubReader.SCROLL_SLICE_OVERSCAN_MULTIPLIER,
      lastMeasuredWidth: this.lastMeasuredWidth,
      getSectionHeight: (sectionId) => this.getSectionHeight(sectionId),
      resolveChapterRenderDecision: (index) =>
        this.resolveChapterRenderDecision(index),
      buildDomMarkup: (section, index) => {
        const input = this.chapterRenderInputs[index];
        return input
          ? this.domChapterRenderer.createMarkup(
              this.createDomRenderInput(section, input)
            )
          : undefined;
      },
      buildCanvasSection: (section, index) => {
        const layout = this.layoutEngine.layout(
          {
            section,
            spineIndex: index,
            viewportWidth: this.getContentWidth(),
            viewportHeight: this.options.container!.clientHeight,
            typography: this.typography,
            fontFamily: this.getFontFamily(),
            resolveImageIntrinsicSize: (src) =>
              this.resolveImageIntrinsicSizeForLayout(src)
          },
          "scroll"
        );
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
          resolveImageIntrinsicSize: (src) =>
            this.resolveImageIntrinsicSizeForLayout(src),
          highlightedBlockIds:
            this.getHighlightedCanvasBlockIdsForSection(index),
          highlightRangesByBlock:
            this.getHighlightedCanvasTextRangesForSection(index),
          underlinedBlockIds: this.getUnderlinedCanvasBlockIdsForSection(index),
          activeBlockId: this.getActiveCanvasBlockIdForSection(index)
        });

        return {
          width: layout.width,
          displayList,
          measuredHeight: displayList.height,
          estimatedHeight: Math.max(this.getPageHeight(), displayList.height)
        };
      }
    });
    const sectionsToRender = plan.sectionsToRender;
    this.sectionEstimatedHeights = plan.sectionEstimatedHeights;
    this.lastMeasuredWidth = plan.lastMeasuredWidth;
    this.lastScrollRenderWindows.clear();
    for (const [
      sectionId,
      renderWindows
    ] of plan.scrollRenderWindows.entries()) {
      this.lastScrollRenderWindows.set(sectionId, renderWindows);
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
    this.lastInteractionRegions = this.offsetInteractionRegionsForScroll(
      result.sections
    );
    for (const entry of sectionsToRender) {
      if (!entry.domHtml) {
        continue;
      }

      const sectionWrapper = this.getSectionElement(entry.sectionId);
      const domSection = sectionWrapper?.matches(".epub-dom-section")
        ? sectionWrapper
        : sectionWrapper?.querySelector<HTMLElement>(".epub-dom-section");
      const sectionIndex = this.getSectionIndexById(entry.sectionId);
      if (domSection && sectionIndex >= 0) {
        annotateDomSectionWithBlockIds(
          this.book.sections[sectionIndex]!,
          domSection
        );
        applyDomDecorations({
          container: this.options.container,
          sectionElement: domSection,
          mode: this.mode,
          decorations: this.decorationManager.getForSpineIndex(sectionIndex)
        });
      }
    }
    this.lastVisibleBounds =
      this.collectVisibleBoundsForScroll(sectionsToRender);
    this.lastRenderedSectionIds = sectionsToRender.map(
      (entry) => entry.sectionId
    );
    const highlightedDrawOpCount = sectionsToRender
      .flatMap((entry) => entry.displayList?.ops ?? [])
      .filter(
        (op) =>
          op.kind === "text" &&
          (Boolean(op.highlightColor) || Boolean(op.highlightSegments?.length))
      ).length;
    const currentDecision = this.resolveChapterRenderDecision(
      this.currentSectionIndex
    );
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
      highlightedBlockIds: this.getHighlightedCanvasBlockIdsForSection(
        page.spineIndex
      ),
      highlightRangesByBlock: this.getHighlightedCanvasTextRangesForSection(
        page.spineIndex
      ),
      underlinedBlockIds: this.getUnderlinedCanvasBlockIdsForSection(
        page.spineIndex
      ),
      activeBlockId: this.getActiveCanvasBlockIdForSection(page.spineIndex),
      resolveImageLoaded: (src) => this.isImageResourceReady(src),
      resolveImageUrl: (src) => this.resolveCanvasResourceUrl(src),
      resolveImageIntrinsicSize: (src) =>
        this.resolveImageIntrinsicSizeForLayout(src),
      estimateBlockHeight: (block) => this.estimateBlockHeightForPage(block),
      buildSectionDisplayList: (input) =>
        this.displayListBuilder.buildSection(input)
    });
  }

  private estimateBlockHeightForPage(block: BlockNode): number {
    return (
      this.layoutEngine.layout(
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
          fontFamily: this.getFontFamily(),
          resolveImageIntrinsicSize: (src) =>
            this.resolveImageIntrinsicSizeForLayout(src)
        },
        "paginated"
      ).blocks[0]?.estimatedHeight ??
      this.typography.fontSize * this.typography.lineHeight
    );
  }

  private isImageResourceReady(src: string): boolean {
    return this.renderableResourceManager.isReady(src);
  }

  private resolveImageIntrinsicSizeForLayout(
    src: string
  ): IntrinsicImageSize | null | undefined {
    const cached = this.imageIntrinsicSizeCache.get(src);
    if (cached) {
      return cached;
    }
    if (this.imageIntrinsicSizeCache.has(src)) {
      return null;
    }

    if (!this.resources || this.pendingImageIntrinsicSizePaths.has(src)) {
      return undefined;
    }

    if (!this.resources.exists(src)) {
      this.imageIntrinsicSizeCache.set(src, null);
      return undefined;
    }

    this.pendingImageIntrinsicSizePaths.add(src);
    this.resources
      .readBinary(src)
      .then((binary) => {
        const resolved = extractIntrinsicImageSize(binary, src);
        this.imageIntrinsicSizeCache.set(src, resolved);
        if (resolved) {
          this.scheduleDeferredResourceRenderRefresh();
        }
      })
      .catch(() => {
        this.imageIntrinsicSizeCache.set(src, null);
      })
      .finally(() => {
        this.pendingImageIntrinsicSizePaths.delete(src);
      });

    return undefined;
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
    const languageContext =
      this.resolveReadingLanguageContextForSection(section);
    const fixedLayoutViewportBox = this.getFixedLayoutViewportBox(section);
    const presentationViewportBox = this.getPresentationViewportBox(section);
    const domRenderInput = createDomChapterRenderInput({
      book: this.book,
      section,
      input,
      theme: this.theme,
      typography: this.typography,
      fontFamily: this.getFontFamily(),
      publisherStyles: this.publisherStyles,
      ...(typeof fixedLayoutViewportBox?.width === "number"
        ? { availableWidth: fixedLayoutViewportBox.width }
        : typeof presentationViewportBox?.width === "number"
          ? { availableWidth: presentationViewportBox.width }
          : typeof this.getContentWidth() === "number"
            ? { availableWidth: this.getContentWidth() }
            : {}),
      ...(typeof fixedLayoutViewportBox?.height === "number"
        ? { availableHeight: fixedLayoutViewportBox.height }
        : typeof presentationViewportBox?.height === "number"
          ? { availableHeight: presentationViewportBox.height }
          : typeof this.options.container?.clientHeight === "number"
            ? { availableHeight: this.options.container.clientHeight }
            : {}),
      resolveDomResourceUrl: (path) => this.resolveDomResourceUrl(path)
    });

    return {
      ...domRenderInput,
      ...(languageContext?.resolvedLanguage
        ? { sectionLanguage: languageContext.resolvedLanguage }
        : {}),
      ...(languageContext?.rtlActive
        ? { sectionDirection: "rtl" as const }
        : {})
    };
  }

  private resolveReadingLanguageContextForSection(
    section: SectionDocument
  ): ReadingLanguageContext | null {
    if (!this.book) {
      return null;
    }

    const spineIndex = this.getSectionIndexById(section.id);
    if (spineIndex < 0) {
      return null;
    }

    return resolveReadingLanguageContext({
      book: this.book,
      section,
      spineIndex,
      experimentalRtl: this.experimentalRtl
    });
  }

  private resolveReadingLanguageContextForSectionIndex(
    spineIndex: number
  ): ReadingLanguageContext | null {
    if (!this.book) {
      return null;
    }

    const section = this.book.sections[spineIndex];
    if (!section) {
      return null;
    }

    return resolveReadingLanguageContext({
      book: this.book,
      section,
      spineIndex,
      experimentalRtl: this.experimentalRtl
    });
  }

  private resolveReadingNavigationContextForSectionIndex(
    spineIndex: number
  ): ReadingNavigationContext | null {
    const languageContext =
      this.resolveReadingLanguageContextForSectionIndex(spineIndex);
    return languageContext
      ? resolveReadingNavigationContext({ languageContext })
      : null;
  }

  private resolveReadingSpreadContextForSectionIndex(
    spineIndex: number
  ): ReadingSpreadContext | null {
    if (!this.book) {
      return null;
    }

    const section = this.book.sections[spineIndex];
    if (!section) {
      return null;
    }

    const navigationContext =
      this.resolveReadingNavigationContextForSectionIndex(spineIndex);
    const dimensions = this.getContainerInnerDimensions();
    return resolveReadingSpreadContext({
      book: this.book,
      section,
      spineIndex,
      mode: this.mode,
      spreadMode: this.spreadMode,
      pageProgression: navigationContext?.pageProgression ?? "ltr",
      containerWidth: dimensions.width,
      containerHeight: dimensions.height
    });
  }

  private getSectionsForRender(): SectionDocument[] {
    return (
      this.book?.sections.map((section) => this.getSectionForRender(section)) ??
      []
    );
  }

  private getSectionForRender(section: SectionDocument): SectionDocument {
    return this.publisherStyles === "enabled"
      ? section
      : stripPublisherStylesFromSection(section);
  }

  private revokeObjectUrls(): void {
    this.renderableResourceManager.revokeAll();
  }

  private getContainerInnerDimensions(): { width: number; height: number } {
    if (!this.options.container) {
      return {
        width: 672,
        height: 720
      };
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
    const paddingTop = computed
      ? Number.parseFloat(computed.paddingTop) || 0
      : 0;
    const paddingBottom = computed
      ? Number.parseFloat(computed.paddingBottom) || 0
      : 0;

    return {
      width: Math.max(120, container.clientWidth - paddingLeft - paddingRight),
      height: Math.max(120, container.clientHeight - paddingTop - paddingBottom)
    };
  }

  private getPaginationMeasurement(): { width: number; height: number } {
    const { height } = this.getContainerInnerDimensions();
    return {
      width: this.getContentWidth(),
      height
    };
  }

  private getFixedLayoutViewportBox(
    section: SectionDocument
  ): { width: number; height: number } | null {
    if (section.renditionLayout !== "pre-paginated") {
      return null;
    }

    const sectionIndex = this.getSectionIndexById(section.id);
    const viewportBox = this.getContainerInnerDimensions();
    if (sectionIndex < 0) {
      return viewportBox;
    }

    const spreadContext =
      this.resolveReadingSpreadContextForSectionIndex(sectionIndex);
    const partition = spreadContext
      ? resolveSyntheticSpreadViewportPartition({
          spreadContext,
          containerWidth: viewportBox.width,
          containerHeight: viewportBox.height
        })
      : null;

    return partition
      ? {
          width: partition.width,
          height: partition.height
        }
      : viewportBox;
  }

  private getPresentationViewportBox(
    section: SectionDocument
  ): { width: number; height: number } | null {
    if (
      section.presentationRole !== "cover" &&
      section.presentationRole !== "image-page"
    ) {
      return null;
    }

    return (
      this.getFixedLayoutViewportBox(section) ??
      this.getContainerInnerDimensions()
    );
  }

  private resolveFixedLayoutRenderSignature(
    section: SectionDocument
  ): string | null {
    const viewportBox = this.getFixedLayoutViewportBox(section);
    if (!viewportBox) {
      return null;
    }

    const frame = resolveFixedLayoutFrame({
      section,
      availableWidth: viewportBox.width,
      availableHeight: viewportBox.height
    });
    if (!frame) {
      return null;
    }

    return `${frame.width}x${frame.height}@${frame.scale.toFixed(4)}`;
  }

  private resolvePresentationRenderSignature(
    section: SectionDocument
  ): string | null {
    const viewportBox = this.getPresentationViewportBox(section);
    if (!viewportBox) {
      return null;
    }

    return `${Math.round(viewportBox.width)}x${Math.round(viewportBox.height)}`;
  }

  private getContentWidth(): number {
    const { width } = this.getContainerInnerDimensions();
    const rootFontSize =
      typeof document !== "undefined"
        ? Number.parseFloat(
            window.getComputedStyle(document.documentElement).fontSize
          ) || 16
        : 16;
    const maxContentWidth = 42 * rootFontSize;
    return Math.min(width, maxContentWidth);
  }

  private getFontFamily(): string {
    if (this.typography.fontFamily?.trim()) {
      return this.typography.fontFamily;
    }

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

      const { width: nextWidth, height: nextHeight } =
        this.getPaginationMeasurement();
      const currentSection = this.book.sections[this.currentSectionIndex];
      const nextFixedLayoutRenderSignature = currentSection
        ? this.resolveFixedLayoutRenderSignature(currentSection)
        : null;
      const nextPresentationRenderSignature = currentSection
        ? this.resolvePresentationRenderSignature(currentSection)
        : null;
      const widthChanged = Math.abs(nextWidth - this.lastMeasuredWidth) >= 1;
      const heightChanged = Math.abs(nextHeight - this.lastMeasuredHeight) >= 1;
      const fixedLayoutChanged =
        nextFixedLayoutRenderSignature !== this.lastFixedLayoutRenderSignature;
      const presentationChanged =
        nextPresentationRenderSignature !==
        this.lastPresentationRenderSignature;

      if (
        !widthChanged &&
        !heightChanged &&
        !fixedLayoutChanged &&
        !presentationChanged
      ) {
        return;
      }

      this.pages = [];
      this.renderCurrentSection("preserve");
    });

    this.resizeObserver.observe(this.options.container);
  }

  private attachScrollListener(): void {
    this.interactionController.attachScrollListener();
  }

  private detachScrollListener(): void {
    this.interactionController.detachScrollListener();
  }

  private attachSelectionChangeListener(): void {
    if (typeof document === "undefined") {
      return;
    }

    document.addEventListener(
      "selectionchange",
      this.handleDocumentSelectionChange
    );
  }

  private attachPointerListener(): void {
    this.interactionController.attachPointerListener();
  }

  private detachPointerListener(): void {
    this.interactionController.detachPointerListener();
  }

  private attachKeyboardListener(): void {
    this.interactionController.attachKeyboardListener();
  }

  private detachKeyboardListener(): void {
    this.interactionController.detachKeyboardListener();
  }

  private handleDomClick(event: MouseEvent): void {
    if (!this.options.container || !this.book) {
      return;
    }

    if (hasActiveTextSelection(this.options.container)) {
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
      ? this.getSectionIndexById(sectionId)
      : this.currentSectionIndex;
    if (sectionIndex < 0) {
      return;
    }

    const point = this.getContainerRelativePoint(event);
    if (!point) {
      return;
    }

    const annotationSelection = this.resolveAnnotationSelectionAtPoint(point);
    if (annotationSelection) {
      event.preventDefault();
      this.setPinnedTextSelectionSnapshot(annotationSelection);
      return;
    }

    if (this.pinnedTextSelectionSnapshot) {
      this.setPinnedTextSelectionSnapshot(null);
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
    const paginatedClickAction =
      this.mode === "paginated"
        ? this.resolvePaginatedClickNavigationAction({
            offsetX: point.x,
            target
          })
        : null;
    if (paginatedClickAction && interaction?.kind !== "link") {
      event.preventDefault();
      this.performPaginatedNavigationAction(paginatedClickAction);
      return;
    }

    if (
      this.mode === "paginated" &&
      !paginatedClickAction &&
      interaction?.kind !== "link"
    ) {
      event.preventDefault();
      const clickedAnchorId = resolveSectionAnchorIdForElement(section, target);
      const anchoredInteractionLocator =
        interaction?.kind === "locator"
          ? {
              ...interaction.locator,
              ...(clickedAnchorId ? { anchorId: clickedAnchorId } : {})
            }
          : null;
      if (interaction?.kind === "locator") {
        this.currentSectionIndex = interaction.locator.spineIndex;
        this.updateLocator(anchoredInteractionLocator ?? interaction.locator);
        this.syncCurrentPageFromSection();
        this.emitRelocated();
      }
      const centerTapLocator =
        interaction?.kind === "locator"
          ? anchoredInteractionLocator ?? interaction.locator
          : (mapDomPointToLocator({
              container: this.options.container,
              sectionElement,
              section,
              spineIndex: sectionIndex,
              point
            }) ?? this.getCurrentLocation());
      this.emitPaginatedCenterTapped({
        source: "dom",
        offsetX: point.x,
        locator: centerTapLocator,
        sectionId: section.id
      });
      return;
    }

    if (!interaction) {
      return;
    }

    if (interaction.kind === "link") {
      event.preventDefault();
      void this.activateLink({
        href: interaction.href,
        source: "dom",
        sectionId: section.id
      });
      return;
    }

    this.currentSectionIndex = interaction.locator.spineIndex;
    const clickedAnchorId = resolveSectionAnchorIdForElement(section, target);
    this.updateLocator({
      ...interaction.locator,
      ...(clickedAnchorId ? { anchorId: clickedAnchorId } : {})
    });
    this.syncCurrentPageFromSection();
    this.emitRelocated();
  }

  private handlePaginatedViewportClick(event: MouseEvent): void {
    if (!this.options.container || !this.book || this.mode !== "paginated") {
      return;
    }

    const point = this.getContainerRelativePoint(event);
    if (!point) {
      return;
    }

    const action = this.resolvePaginatedClickNavigationAction({
      offsetX: point.x,
      ...(event.target instanceof HTMLElement ? { target: event.target } : {})
    });
    if (!action) {
      return;
    }

    event.preventDefault();
    this.performPaginatedNavigationAction(action);
  }

  private resolvePaginatedClickNavigationAction(input: {
    offsetX: number;
    target?: HTMLElement;
  }): "previous" | "next" | null {
    if (!this.options.container) {
      return null;
    }

    const width = this.options.container.clientWidth;
    if (width <= 0) {
      return null;
    }

    const navigationContext = this.getReadingNavigationContext();
    if (!navigationContext) {
      return null;
    }

    const spread = this.resolveCurrentPaginatedSpread();
    if (spread && spread.slots.length === 2) {
      const slotPosition = this.resolvePaginatedSpreadClickSlot({
        offsetX: input.offsetX,
        ...(input.target ? { target: input.target } : {})
      });
      if (slotPosition === "left") {
        return navigationContext.pageProgression === "rtl"
          ? "next"
          : "previous";
      }

      if (slotPosition === "right") {
        return navigationContext.pageProgression === "rtl"
          ? "previous"
          : "next";
      }
    }

    const normalizedX = Math.max(0, Math.min(input.offsetX, width));
    const zoneWidth = width * EpubReader.PAGINATED_CLICK_NAV_ZONE_RATIO;
    if (normalizedX <= zoneWidth) {
      return navigationContext.pageProgression === "rtl" ? "next" : "previous";
    }

    if (normalizedX >= width - zoneWidth) {
      return navigationContext.pageProgression === "rtl" ? "previous" : "next";
    }

    return null;
  }

  private resolvePaginatedSpreadClickSlot(input: {
    offsetX: number;
    target?: HTMLElement;
  }): "left" | "right" | null {
    if (!this.options.container) {
      return null;
    }

    const slotElement =
      input.target?.closest<HTMLElement>("[data-spread-slot]");
    const slotName = slotElement?.dataset.spreadSlot;
    if (slotName === "left" || slotName === "right") {
      return slotName;
    }

    const width = this.options.container.clientWidth;
    if (width <= 0) {
      return null;
    }

    return input.offsetX < width / 2 ? "left" : "right";
  }

  private performPaginatedNavigationAction(action: "previous" | "next"): void {
    if (action === "next") {
      void this.next();
      return;
    }

    void this.prev();
  }

  private emitPaginatedCenterTapped(input: {
    source: "dom" | "canvas";
    offsetX: number;
    locator?: Locator | null;
    sectionId?: string;
  }): void {
    if (this.mode !== "paginated" || !this.options.container) {
      return;
    }

    const locator = input.locator ?? null;
    const sectionFromId =
      input.sectionId && this.book
        ? this.book.sections.find((section) => section.id === input.sectionId)
        : null;
    const sectionFromLocator =
      !sectionFromId &&
      this.book &&
      locator &&
      Number.isInteger(locator.spineIndex) &&
      locator.spineIndex >= 0 &&
      locator.spineIndex < this.book.sections.length
        ? this.book.sections[locator.spineIndex]
        : null;
    const section = sectionFromId ?? sectionFromLocator;

    const payload = {
      locator,
      source: input.source,
      offsetX: input.offsetX,
      containerWidth: this.options.container.clientWidth,
      ...(section?.id ? { sectionId: section.id } : {}),
      ...(section?.href ? { sectionHref: section.href } : {})
    } satisfies ReaderEventMap["paginatedCenterTapped"];

    this.events.emit("paginatedCenterTapped", payload);
    this.invokeReaderHook(() => this.options.onPaginatedCenterTap?.(payload));
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
    if (this.mode === "scroll") {
      const nextScrollTop =
        this.options.container.scrollTop +
        targetRect.top -
        containerRect.top -
        16;
      this.setProgrammaticScrollTop(nextScrollTop);
    }

    const containerWidth =
      this.options.container.clientWidth || Math.max(1, containerRect.width);
    const containerHeight =
      this.options.container.clientHeight || Math.max(1, containerRect.height);
    const targetPoint = {
      x: Math.max(
        0,
        Math.min(
          targetRect.left -
            containerRect.left +
            Math.max(1, Math.min(12, targetRect.width / 2)),
          containerWidth - 1
        )
      ),
      y: Math.max(
        0,
        Math.min(
          targetRect.top -
            containerRect.top +
            Math.max(1, Math.min(12, targetRect.height / 2)),
          containerHeight - 1
        )
      )
    };
    const preciseLocator = this.mapDomViewportPointToLocator(targetPoint);
    if (!preciseLocator) {
      return;
    }

    this.currentSectionIndex = preciseLocator.spineIndex;
    this.updateLocator({
      ...result.locator,
      ...preciseLocator,
      ...((preciseLocator.blockId ?? result.locator.blockId)
        ? { blockId: preciseLocator.blockId ?? result.locator.blockId }
        : {}),
      ...((preciseLocator.anchorId ?? result.locator.anchorId)
        ? { anchorId: preciseLocator.anchorId ?? result.locator.anchorId }
        : {})
    });
    this.syncCurrentPageFromSection();
    this.emitRelocated();
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

  private ensurePages(sectionLayout?: LayoutResult): void {
    if (!this.book || !this.options.container) {
      this.pages = [];
      return;
    }

    const { width: targetWidth, height: targetHeight } =
      this.getPaginationMeasurement();
    if (
      this.pages.length > 0 &&
      sectionLayout === undefined &&
      Math.abs(this.lastMeasuredWidth - targetWidth) < 1 &&
      Math.abs(this.lastMeasuredHeight - targetHeight) < 1
    ) {
      return;
    }

    const pageHeight = this.getPageHeight();
    const plan = buildPaginatedPages({
      sections: this.getSectionsForRender(),
      currentSectionIndex: this.currentSectionIndex,
      sectionLayout,
      pageHeight,
      getSectionLayout: (section, index) =>
        this.layoutEngine.layout(
          {
            section,
            spineIndex: index,
            viewportWidth: targetWidth,
            viewportHeight: targetHeight,
            typography: this.typography,
            fontFamily: this.getFontFamily(),
            resolveImageIntrinsicSize: (src) =>
              this.resolveImageIntrinsicSizeForLayout(src)
          },
          "paginated"
        )
    });

    this.sectionEstimatedHeights = plan.sectionEstimatedHeights;
    this.pages = plan.pages;
  }

  private getPageHeight(): number {
    return this.getContainerInnerDimensions().height;
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

  private findPageByNumber(pageNumber: number): ReaderPage | null {
    return this.pages[pageNumber - 1] ?? null;
  }

  private resolvePaginatedSpread(
    page: ReaderPage | null
  ): PaginatedSpread | null {
    if (!page || !this.book) {
      return null;
    }

    const spreadContext = this.resolveReadingSpreadContextForSectionIndex(
      page.spineIndex
    );
    if (!spreadContext || !spreadContext.syntheticSpreadActive) {
      const section = this.book.sections[page.spineIndex] ?? null;
      return {
        anchorPageNumber: page.pageNumber,
        pageNumbers: [page.pageNumber],
        currentPageNumber: page.pageNumber,
        slots: [
          {
            position: "center",
            page,
            section,
            isBlank: false
          }
        ]
      };
    }

    if (spreadContext.pageSpreadPlacement === "center") {
      const section = this.book.sections[page.spineIndex] ?? null;
      return {
        anchorPageNumber: page.pageNumber,
        pageNumbers: [page.pageNumber],
        currentPageNumber: page.pageNumber,
        slots: [
          {
            position: "center",
            page,
            section,
            isBlank: false
          }
        ]
      };
    }

    if (spreadContext.pageSpreadPlacement === "left") {
      const pairedPage = this.resolvePairedSpreadPage(page, "next");
      const currentSection = this.book.sections[page.spineIndex] ?? null;
      const pairedSection = pairedPage
        ? (this.book.sections[pairedPage.spineIndex] ?? null)
        : null;
      return {
        anchorPageNumber: page.pageNumber,
        pageNumbers: pairedPage
          ? [page.pageNumber, pairedPage.pageNumber]
          : [page.pageNumber],
        currentPageNumber: page.pageNumber,
        slots: [
          {
            position: "left",
            page,
            section: currentSection,
            isBlank: false
          },
          {
            position: "right",
            page: pairedPage,
            section: pairedSection,
            isBlank: !pairedPage
          }
        ]
      };
    }

    const pairedPage = this.resolvePairedSpreadPage(page, "previous");
    const currentSection = this.book.sections[page.spineIndex] ?? null;
    const pairedSection = pairedPage
      ? (this.book.sections[pairedPage.spineIndex] ?? null)
      : null;
    return {
      anchorPageNumber: pairedPage?.pageNumber ?? page.pageNumber,
      pageNumbers: pairedPage
        ? [pairedPage.pageNumber, page.pageNumber]
        : [page.pageNumber],
      currentPageNumber: page.pageNumber,
      slots: [
        {
          position: "left",
          page: pairedPage,
          section: pairedSection,
          isBlank: !pairedPage
        },
        {
          position: "right",
          page,
          section: currentSection,
          isBlank: false
        }
      ]
    };
  }

  private resolvePairedSpreadPage(
    page: ReaderPage,
    direction: "previous" | "next"
  ): ReaderPage | null {
    const candidate = this.findPageByNumber(
      direction === "previous" ? page.pageNumber - 1 : page.pageNumber + 1
    );
    if (!candidate || !this.book) {
      return null;
    }

    const currentSpreadContext =
      this.resolveReadingSpreadContextForSectionIndex(page.spineIndex);
    const candidateSpreadContext =
      this.resolveReadingSpreadContextForSectionIndex(candidate.spineIndex);
    if (
      !currentSpreadContext?.syntheticSpreadActive ||
      !candidateSpreadContext?.syntheticSpreadActive
    ) {
      return null;
    }

    if (direction === "previous") {
      return candidateSpreadContext.pageSpreadPlacement === "left"
        ? candidate
        : null;
    }

    return candidateSpreadContext.pageSpreadPlacement === "right"
      ? candidate
      : null;
  }

  private resolveCurrentPaginatedSpread(): PaginatedSpread | null {
    if (this.mode !== "paginated") {
      return null;
    }

    const currentPage = this.findPageByNumber(this.currentPageNumber);
    return this.resolvePaginatedSpread(currentPage);
  }

  private getVisiblePaginatedSpreads(): PaginatedSpread[] {
    if (this.mode !== "paginated" || this.pages.length === 0) {
      return [];
    }

    const spreads: PaginatedSpread[] = [];
    let nextLeafPageNumber = 1;

    while (nextLeafPageNumber <= this.pages.length) {
      const page = this.findPageByNumber(nextLeafPageNumber);
      if (!page) {
        nextLeafPageNumber += 1;
        continue;
      }

      const spread = this.resolvePaginatedSpread(page);
      if (!spread) {
        nextLeafPageNumber += 1;
        continue;
      }

      spreads.push(spread);
      const lastPageNumber =
        spread.pageNumbers[spread.pageNumbers.length - 1] ?? page.pageNumber;
      nextLeafPageNumber = Math.max(lastPageNumber + 1, nextLeafPageNumber + 1);
    }

    return spreads;
  }

  private resolveDisplayPageNumberToLeafPage(
    pageNumber: number
  ): number | null {
    const spreads = this.getVisiblePaginatedSpreads();
    if (spreads.length === 0) {
      return null;
    }

    const targetSpread =
      spreads[Math.max(0, Math.min(pageNumber - 1, spreads.length - 1))];
    return targetSpread?.anchorPageNumber ?? null;
  }

  private resolveSpreadNavigationTarget(
    action: "previous" | "next"
  ): number | null {
    const spread = this.resolveCurrentPaginatedSpread();
    if (!spread) {
      return null;
    }

    // Navigation advances by visible spread, not raw leaf page, so a synthetic
    // spread turns with one action instead of stepping into its paired page.
    const boundaryPageNumber =
      action === "next"
        ? (spread.pageNumbers[spread.pageNumbers.length - 1] ??
            spread.currentPageNumber) + 1
        : spread.anchorPageNumber - 1;
    const targetPage = this.findPageByNumber(boundaryPageNumber);
    if (!targetPage) {
      return null;
    }

    const targetSpread = this.resolvePaginatedSpread(targetPage);
    return targetSpread?.anchorPageNumber ?? targetPage.pageNumber;
  }

  private syncCurrentPageFromSection(): void {
    if (this.mode === "scroll") {
      this.currentPageNumber = this.currentSectionIndex + 1;
      return;
    }

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
        : findBlockById([slice.block], blockId) !== null
    );
  }

  private getProgressForCurrentLocator(): number {
    if (!this.locator) {
      return 0;
    }

    if (this.mode === "scroll") {
      return clampProgress(this.locator.progressInSection ?? 0);
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

  private syncDerivedDecorationGroups(): void {
    if (!this.locator || !this.debugMode) {
      this.decorationManager.clearDerivedGroup("current-location");
    } else {
      this.decorationManager.setDerivedGroup("current-location", [
        {
          id: "current-location:active",
          group: "current-location",
          locator: this.locator,
          style: "active"
        }
      ]);
    }
  }

  private getHighlightedCanvasBlockIdsForSection(
    sectionIndex: number
  ): Set<string> {
    if (!this.book) {
      return new Set();
    }

    const section = this.book.sections[sectionIndex];
    if (!section) {
      return new Set();
    }

    return new Set(
      this.decorationManager
        .getForSpineIndex(sectionIndex)
        .filter(
          (decoration) =>
            (decoration.style === "highlight" ||
              decoration.style === "search-hit") &&
            !decoration.extras?.textRange
        )
        .map((decoration) =>
          decoration.locator.blockId
            ? (resolveRenderableBlockId(
                section.blocks,
                decoration.locator.blockId
              ) ?? decoration.locator.blockId)
            : undefined
        )
        .filter((blockId): blockId is string => Boolean(blockId))
    );
  }

  private getHighlightedCanvasTextRangesForSection(
    sectionIndex: number
  ): Map<string, Array<{ start: number; end: number; color: string }>> {
    if (!this.book) {
      return new Map();
    }

    const section = this.book.sections[sectionIndex];
    if (!section) {
      return new Map();
    }

    const rangesByBlock = new Map<
      string,
      Array<{ start: number; end: number; color: string }>
    >();
    const defaultColor = toTransparentHighlightColor(
      buildReadingStyleProfile({
        theme: this.theme,
        typography: this.typography
      }).highlight.mark
    );

    for (const decoration of this.decorationManager.getForSpineIndex(
      sectionIndex
    )) {
      const textRange = decoration.extras?.textRange;
      if (decoration.style !== "highlight" || !textRange) {
        continue;
      }

      const normalizedRange = normalizeTextRangeSelector(textRange);
      const blockIds = collectBlockIdsInReadingOrder(section.blocks);
      const startIndex = blockIds.indexOf(normalizedRange.start.blockId);
      const endIndex = blockIds.indexOf(normalizedRange.end.blockId);
      if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
        continue;
      }

      for (
        let blockIndex = startIndex;
        blockIndex <= endIndex;
        blockIndex += 1
      ) {
        const blockId = blockIds[blockIndex];
        if (!blockId) {
          continue;
        }

        const renderableBlockId = resolveRenderableBlockId(
          section.blocks,
          blockId
        );
        if (!renderableBlockId || renderableBlockId !== blockId) {
          continue;
        }

        const block = findBlockById(section.blocks, blockId);
        const blockTextLength = block
          ? Array.from(this.extractBlockText(block)).length
          : 0;
        const start =
          blockId === normalizedRange.start.blockId
            ? Math.max(
                0,
                Math.min(blockTextLength, normalizedRange.start.inlineOffset)
              )
            : 0;
        const end =
          blockId === normalizedRange.end.blockId
            ? Math.max(
                start,
                Math.min(blockTextLength, normalizedRange.end.inlineOffset)
              )
            : blockTextLength;
        if (end <= start) {
          continue;
        }

        const entry = rangesByBlock.get(blockId) ?? [];
        entry.push({
          start,
          end,
          color: toTransparentHighlightColor(decoration.color ?? defaultColor)
        });
        rangesByBlock.set(blockId, entry);
      }
    }

    return rangesByBlock;
  }

  private getActiveCanvasBlockIdForSection(
    sectionIndex: number
  ): string | undefined {
    if (!this.book) {
      return undefined;
    }

    const section = this.book.sections[sectionIndex];
    const locator = this.decorationManager.getFirstLocatorForStyle("active");
    if (
      !section ||
      !locator ||
      locator.spineIndex !== sectionIndex ||
      !locator.blockId
    ) {
      return undefined;
    }

    return (
      resolveRenderableBlockId(section.blocks, locator.blockId) ??
      locator.blockId
    );
  }

  private getUnderlinedCanvasBlockIdsForSection(
    sectionIndex: number
  ): Set<string> {
    if (!this.book) {
      return new Set();
    }

    const section = this.book.sections[sectionIndex];
    if (!section) {
      return new Set();
    }

    return new Set(
      this.decorationManager
        .getForSpineIndex(sectionIndex)
        .filter((decoration) => decoration.style === "underline")
        .map((decoration) =>
          decoration.locator.blockId
            ? (resolveRenderableBlockId(
                section.blocks,
                decoration.locator.blockId
              ) ?? decoration.locator.blockId)
            : undefined
        )
        .filter((blockId): blockId is string => Boolean(blockId))
    );
  }

  private resolveCanvasViewportBlockIds(locator: Locator): string[] {
    const blockId = locator.blockId;
    if (!blockId) {
      return [];
    }

    const section = this.book?.sections[locator.spineIndex];
    if (!section) {
      return [blockId];
    }

    const renderableBlockId = resolveRenderableBlockId(section.blocks, blockId);
    return renderableBlockId && renderableBlockId !== blockId
      ? [blockId, renderableBlockId]
      : [blockId];
  }

  private syncAnnotationDecorations(): void {
    this.decorationManager.setExplicitGroup(
      "annotations",
      mapAnnotationsToDecorations(this.annotations)
    );
    if (this.book) {
      this.renderCurrentSection("preserve");
    }
  }

  private resolveAnnotationQuote(locator: Locator): string | undefined {
    const section = this.book?.sections[locator.spineIndex];
    const blockId = locator.blockId;
    if (!section || !blockId) {
      return undefined;
    }

    const block = findBlockById(section.blocks, blockId);
    if (!block) {
      return undefined;
    }

    const text = collectBlockText(block).replace(/\s+/g, " ").trim();
    return text || undefined;
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

    const target = findRenderedAnchorTarget(
      sectionElement,
      this.locator.anchorId
    );
    if (!target) {
      return false;
    }

    const containerRect = this.options.container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const nextScrollTop =
      this.options.container.scrollTop +
      targetRect.top -
      containerRect.top -
      16;
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
      this.updateLocator({
        ...this.locator,
        spineIndex: this.currentSectionIndex,
        progressInSection: this.getProgressForCurrentLocator()
      });
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
    this.updateLocator({
      spineIndex: nextSectionIndex,
      progressInSection: progress,
      ...(preservedAnchorId ? { anchorId: preservedAnchorId } : {}),
      ...(preservedBlockId ? { blockId: preservedBlockId } : {})
    });
    this.syncCurrentPageFromSection();

    if (emitEvent) {
      this.emitRelocated();
    }

    return true;
  }

  private findRenderedSectionIndexForOffset(offset: number): number {
    const book = this.book;
    const container = this.options.container;
    if (!container || !book) {
      return -1;
    }

    const renderedSections = Array.from(
      container.querySelectorAll<HTMLElement>("article[data-section-id]")
    )
      .map((element) => {
        const sectionId = element.dataset.sectionId;
        if (!sectionId) {
          return null;
        }

        const sectionIndex = book.sections.findIndex(
          (section) => section.id === sectionId
        );
        if (sectionIndex < 0) {
          return null;
        }

        const height = getRenderedSectionHeight(element);
        if (height <= 0) {
          return null;
        }

        return {
          sectionIndex,
          top: element.offsetTop,
          height
        };
      })
      .filter(
        (
          entry
        ): entry is {
          sectionIndex: number;
          top: number;
          height: number;
        } => entry !== null
      )
      .sort((left, right) => left.top - right.top);

    if (renderedSections.length === 0) {
      return -1;
    }

    const firstSection = renderedSections[0];
    if (firstSection && offset < firstSection.top) {
      return firstSection.sectionIndex;
    }

    for (let index = 0; index < renderedSections.length; index += 1) {
      const entry = renderedSections[index];
      if (!entry) {
        continue;
      }
      const next = renderedSections[index + 1] ?? null;
      if (offset < entry.top + entry.height) {
        return entry.sectionIndex;
      }
      if (next && offset < next.top) {
        return entry.sectionIndex;
      }
    }

    return renderedSections[renderedSections.length - 1]?.sectionIndex ?? -1;
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
      const sectionIndex = this.getSectionIndexById(sectionId);
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
      const visibleBottom = Math.min(
        viewportBottom,
        sectionTop + sectionHeight
      );
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
        (entry) =>
          scrollTop >= entry.top && scrollTop < entry.top + entry.height
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
    this.setProgrammaticScrollTop(
      Math.max(0, sectionTop + anchor.offsetWithinSection)
    );
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
      const containerRect = this.options.container.getBoundingClientRect();
      for (const sectionId of candidateSectionIds) {
        const sectionIndex = this.getSectionIndexById(sectionId);
        if (sectionIndex < 0) {
          continue;
        }

        const section = this.book.sections[sectionIndex];
        const sectionElement = this.getSectionElement(sectionId);
        if (
          !section ||
          !sectionElement ||
          !isRenderedDomSectionElement(sectionElement)
        ) {
          continue;
        }

        const rect = sectionElement.getBoundingClientRect();
        const relativeLeft = rect.left - containerRect.left;
        const relativeTop = rect.top - containerRect.top;
        if (
          point.x >= relativeLeft &&
          point.x <= relativeLeft + rect.width &&
          point.y >= relativeTop &&
          point.y <= relativeTop + rect.height
        ) {
          return {
            section,
            sectionIndex,
            sectionElement
          };
        }
      }

      for (const sectionId of candidateSectionIds) {
        const sectionIndex = this.getSectionIndexById(sectionId);
        if (sectionIndex < 0) {
          continue;
        }

        const section = this.book.sections[sectionIndex];
        const sectionElement = this.getSectionElement(sectionId);
        if (
          !section ||
          !sectionElement ||
          !isRenderedDomSectionElement(sectionElement)
        ) {
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
      const sectionIndex = this.getSectionIndexById(sectionId);
      if (sectionIndex < 0) {
        continue;
      }

      const section = this.book.sections[sectionIndex];
      const sectionElement = this.getSectionElement(sectionId);
      if (
        !section ||
        !sectionElement ||
        !isRenderedDomSectionElement(sectionElement)
      ) {
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
    const sectionIndex = this.getSectionIndexById(sectionId);
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
    for (let index = 0; index < sectionIndex; index += 1) {
      const section = this.book.sections[index];
      if (!section) {
        continue;
      }
      offset += this.getSectionHeight(section.id);
    }
    return offset;
  }

  private getSectionHeight(sectionId: string): number {
    const sectionElement = this.getSectionElement(sectionId);
    if (sectionElement && sectionElement.offsetHeight > 0) {
      return sectionElement.offsetHeight;
    }
    if (sectionElement) {
      const domSection =
        sectionElement.querySelector<HTMLElement>(".epub-dom-section");
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
    const index = this.getSectionIndexById(sectionId);
    if (index < 0) {
      return this.getPageHeight();
    }
    return Math.max(
      this.getPageHeight(),
      this.sectionEstimatedHeights[index] ?? this.getPageHeight()
    );
  }

  private rebuildSectionIndex(): void {
    this.sectionIndexById.clear();
    if (!this.book) {
      return;
    }

    this.book.sections.forEach((section, index) => {
      this.sectionIndexById.set(section.id, index);
    });
  }

  private getSectionIndexById(sectionId?: string | null): number {
    if (!sectionId) {
      return -1;
    }

    const indexed = this.sectionIndexById.get(sectionId);
    if (typeof indexed === "number") {
      return indexed;
    }

    if (!this.book) {
      return -1;
    }

    const fallbackIndex = this.book.sections.findIndex(
      (section) => section.id === sectionId
    );
    if (fallbackIndex >= 0) {
      this.sectionIndexById.set(sectionId, fallbackIndex);
    }
    return fallbackIndex;
  }

  private findSectionIndexForOffset(offset: number): number {
    const renderedSectionIndex = this.findRenderedSectionIndexForOffset(offset);
    if (renderedSectionIndex >= 0) {
      return renderedSectionIndex;
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

  private resolveSelectionTarget(node: Node | null): {
    element: HTMLElement;
    locator: Locator;
    sectionId: string;
    blockId?: string;
  } | null {
    if (!this.book || !this.options.container || !node) {
      return null;
    }

    const element = node instanceof HTMLElement ? node : node.parentElement;
    if (
      !(element instanceof HTMLElement) ||
      !this.options.container.contains(element)
    ) {
      return null;
    }

    const canvasTextRun = element.closest<HTMLElement>(".epub-text-run");
    if (canvasTextRun) {
      const sectionId = canvasTextRun.dataset.readerSectionId?.trim();
      const blockId = canvasTextRun.dataset.readerBlockId?.trim();
      const sectionIndex = sectionId ? this.getSectionIndexById(sectionId) : -1;
      const section =
        sectionIndex >= 0 ? this.book.sections[sectionIndex] : null;
      if (sectionId && section && blockId) {
        return {
          element: canvasTextRun,
          locator: createBlockLocator({
            section,
            spineIndex: sectionIndex,
            blockId
          }),
          sectionId,
          blockId
        };
      }
    }

    const domSection = element.closest<HTMLElement>(".epub-dom-section");
    if (!(domSection instanceof HTMLElement)) {
      return null;
    }

    const sectionId = domSection.dataset.sectionId?.trim();
    const sectionIndex = sectionId ? this.getSectionIndexById(sectionId) : -1;
    const section = sectionIndex >= 0 ? this.book.sections[sectionIndex] : null;
    if (!sectionId || !section) {
      return null;
    }

    const identifiedElement = element.closest<HTMLElement>(
      "[id], [data-reader-block-id]"
    );
    const blockId =
      identifiedElement?.dataset.readerBlockId?.trim() ||
      identifiedElement?.id?.trim();
    if (blockId) {
      return {
        element: identifiedElement ?? domSection,
        locator: createBlockLocator({
          section,
          spineIndex: sectionIndex,
          blockId
        }),
        sectionId,
        blockId
      };
    }

    return {
      element: domSection,
      locator: normalizeLocator({
        spineIndex: sectionIndex,
        progressInSection:
          this.locator?.spineIndex === sectionIndex
            ? (this.locator.progressInSection ?? 0)
            : 0
      }),
      sectionId
    };
  }

  private resolveSelectionEndpoint(input: {
    node: Node | null;
    offset: number;
  }): {
    element: HTMLElement;
    locator: Locator;
    sectionId: string;
    blockId?: string;
    inlineOffset?: number;
  } | null {
    const target = this.resolveSelectionTarget(input.node);
    if (!target || !target.blockId) {
      return target;
    }

    const clampedOffset = Math.max(0, Math.trunc(input.offset));
    const canvasTextRun = target.element.closest<HTMLElement>(".epub-text-run");
    if (canvasTextRun) {
      const inlineStart =
        Number.parseInt(canvasTextRun.dataset.readerInlineStart ?? "0", 10) ||
        0;
      const inlineEnd =
        Number.parseInt(
          canvasTextRun.dataset.readerInlineEnd ?? `${inlineStart}`,
          10
        ) || inlineStart;
      const inlineOffset = Math.max(
        inlineStart,
        Math.min(inlineEnd, inlineStart + clampedOffset)
      );
      return {
        ...target,
        locator: normalizeLocator({
          ...target.locator,
          inlineOffset
        }),
        inlineOffset
      };
    }

    const inlineOffset = resolveDomTextOffsetWithinBlock(
      target.element,
      input.node,
      clampedOffset
    );
    return {
      ...target,
      locator: normalizeLocator({
        ...target.locator,
        inlineOffset
      }),
      inlineOffset
    };
  }

  private resolveCurrentTextSelectionSnapshot(): ReaderTextSelectionSnapshot | null {
    if (!this.book || !this.options.container) {
      return null;
    }

    const selection = getScopedTextSelectionRecord(this.options.container);
    if (!selection) {
      return cloneReaderTextSelectionSnapshot(this.pinnedTextSelectionSnapshot);
    }

    const startTarget = this.resolveSelectionEndpoint({
      node: selection.startNode,
      offset: selection.range?.startOffset ?? 0
    });
    const endTarget = this.resolveSelectionEndpoint({
      node: selection.endNode,
      offset: selection.range?.endOffset ?? 0
    });
    const target =
      resolveLeadingSelectionTarget(startTarget, endTarget) ??
      startTarget ??
      endTarget;
    if (!target) {
      return null;
    }

    const rects = measureSelectionRectsWithinContainer({
      container: this.options.container,
      selection: selection.selection,
      fallbackElement: target.element,
      mode: this.mode
    });

    return {
      text: selection.text,
      locator: normalizeLocator({
        ...target.locator,
        ...(target.inlineOffset !== undefined
          ? { inlineOffset: target.inlineOffset }
          : {})
      }),
      sectionId: target.sectionId,
      ...(target.blockId ? { blockId: target.blockId } : {}),
      ...(startTarget &&
      endTarget &&
      startTarget.sectionId === endTarget.sectionId &&
      startTarget.blockId &&
      endTarget.blockId
        ? {
            textRange: normalizeTextRangeSelector({
              start: {
                blockId: startTarget.blockId,
                inlineOffset: startTarget.inlineOffset ?? 0
              },
              end: {
                blockId: endTarget.blockId,
                inlineOffset:
                  endTarget.inlineOffset ?? startTarget.inlineOffset ?? 0
              }
            })
          }
        : {}),
      rects,
      visible: rects.length > 0
    };
  }

  private setPinnedTextSelectionSnapshot(
    selection: ReaderTextSelectionSnapshot | null
  ): void {
    this.pinnedTextSelectionSnapshot =
      cloneReaderTextSelectionSnapshot(selection);
    this.updateTextSelectionSnapshot(selection);
  }

  private resolveSelectionHighlightState(
    selection: ReaderTextSelectionSnapshot
  ): ReaderSelectionHighlightState {
    if (!this.book || !selection.textRange) {
      return {
        mode: "highlight",
        disabled: false
      };
    }

    const section = this.book.sections[selection.locator.spineIndex];
    if (!section) {
      return {
        mode: "highlight",
        disabled: false
      };
    }

    const context = this.createSectionTextRangeContext(section);
    const selectionRange = this.normalizeTextRangeForSection(
      selection.locator.spineIndex,
      selection.textRange
    );
    if (!selectionRange) {
      return {
        mode: "highlight",
        disabled: false
      };
    }

    const flattenedSelection = flattenTextRange(selectionRange, context);
    if (!flattenedSelection) {
      return {
        mode: "highlight",
        disabled: false
      };
    }

    let remainingRanges = [flattenedSelection];
    for (const resolved of this.resolveAnnotationRangesForSection(
      selection.locator.spineIndex
    )) {
      const flattened = flattenTextRange(resolved.range, context);
      if (!flattened) {
        continue;
      }

      remainingRanges = remainingRanges.flatMap((range) =>
        subtractFlattenedRange(range, flattened)
      );
      if (remainingRanges.length === 0) {
        return {
          mode: "remove-highlight",
          disabled: false
        };
      }
    }

    return {
      mode: "highlight",
      disabled: false
    };
  }

  private resolveAnnotationRangesForSection(
    spineIndex: number
  ): ResolvedAnnotationRange[] {
    return this.annotations
      .map((annotation) => this.resolveAnnotationRange(annotation))
      .filter((entry): entry is ResolvedAnnotationRange =>
        Boolean(entry && entry.spineIndex === spineIndex)
      );
  }

  private resolveAnnotationRange(
    annotation: Annotation
  ): ResolvedAnnotationRange | null {
    const book = this.book;
    if (!book) {
      return null;
    }

    const locator = restoreLocatorWithDiagnostics({
      book,
      locator: annotation.locator
    }).locator;
    if (!locator) {
      return null;
    }

    const section = book.sections[locator.spineIndex];
    if (!section) {
      return null;
    }

    const range = annotation.textRange
      ? this.normalizeTextRangeForSection(
          locator.spineIndex,
          annotation.textRange
        )
      : this.resolveFullBlockTextRange(section, locator.blockId);
    if (!range) {
      return null;
    }

    return {
      annotation,
      locator,
      spineIndex: locator.spineIndex,
      sectionId: section.id,
      range
    };
  }

  private createSectionTextRangeContext(
    section: SectionDocument
  ): SectionTextRangeContext {
    const blocks = collectSelectableBlocksInReadingOrder(section.blocks);
    const blockIds: string[] = [];
    const blockTexts = new Map<string, string>();
    const blockTextLengths = new Map<string, number>();
    const blockOffsets = new Map<string, number>();
    let cursor = 0;

    for (const block of blocks) {
      if (blockTexts.has(block.id)) {
        continue;
      }

      const text = this.extractBlockText(block);
      blockIds.push(block.id);
      blockTexts.set(block.id, text);
      blockTextLengths.set(block.id, Array.from(text).length);
      blockOffsets.set(block.id, cursor);
      cursor += Array.from(text).length;
    }

    return {
      blockIds,
      blockTexts,
      blockTextLengths,
      blockOffsets,
      totalLength: cursor
    };
  }

  private normalizeTextRangeForSection(
    spineIndex: number,
    textRange: TextRangeSelector
  ): TextRangeSelector | null {
    const section = this.book?.sections[spineIndex];
    if (!section) {
      return null;
    }

    const context = this.createSectionTextRangeContext(section);
    return normalizeTextRangeForContext({
      textRange,
      context,
      resolveBlockId: (blockId) =>
        resolveRenderableBlockId(section.blocks, blockId) ?? blockId
    });
  }

  private resolveFullBlockTextRange(
    section: SectionDocument,
    blockId: string | undefined
  ): TextRangeSelector | null {
    const normalizedBlockId = blockId?.trim();
    if (!normalizedBlockId) {
      return null;
    }

    const renderableBlockId =
      resolveRenderableBlockId(section.blocks, normalizedBlockId) ??
      normalizedBlockId;
    const block = findBlockById(section.blocks, renderableBlockId);
    if (!block) {
      return null;
    }

    const blockTextLength = Array.from(this.extractBlockText(block)).length;
    return {
      start: {
        blockId: renderableBlockId,
        inlineOffset: 0
      },
      end: {
        blockId: renderableBlockId,
        inlineOffset: blockTextLength
      }
    };
  }

  private createAnnotationForResolvedRange(input: {
    annotation?: Annotation;
    locator: Locator;
    range: TextRangeSelector;
    section: SectionDocument;
    color?: string;
    note?: string;
  }): Annotation | null {
    const publicationId =
      input.annotation?.publicationId ?? this.getPublicationId();
    if (!publicationId) {
      return null;
    }

    const rangeLocator = normalizeLocator({
      spineIndex: input.locator.spineIndex,
      blockId: input.range.start.blockId,
      inlineOffset: input.range.start.inlineOffset,
      progressInSection: input.locator.progressInSection ?? 0
    });
    const quote = this.resolveTextRangeQuote(input.section, input.range);

    return createReaderAnnotation({
      publicationId,
      locator: rangeLocator,
      ...(this.book ? { book: this.book } : {}),
      textRange: input.range,
      ...(quote ? { quote } : {}),
      ...(input.note ? { note: input.note } : {}),
      ...(input.color ? { color: input.color } : {}),
      ...(input.annotation ? { createdAt: input.annotation.createdAt } : {}),
      ...(input.annotation ? { updatedAt: new Date().toISOString() } : {})
    });
  }

  private resolveTextRangeQuote(
    section: SectionDocument,
    textRange: TextRangeSelector
  ): string | undefined {
    const context = this.createSectionTextRangeContext(section);
    const normalizedRange = normalizeTextRangeForContext({
      textRange,
      context
    });
    if (!normalizedRange) {
      return undefined;
    }

    const startIndex = context.blockIds.indexOf(normalizedRange.start.blockId);
    const endIndex = context.blockIds.indexOf(normalizedRange.end.blockId);
    if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
      return undefined;
    }

    const segments: string[] = [];
    for (let index = startIndex; index <= endIndex; index += 1) {
      const blockId = context.blockIds[index];
      if (!blockId) {
        continue;
      }

      const characters = Array.from(context.blockTexts.get(blockId) ?? "");
      const start =
        blockId === normalizedRange.start.blockId
          ? normalizedRange.start.inlineOffset
          : 0;
      const end =
        blockId === normalizedRange.end.blockId
          ? normalizedRange.end.inlineOffset
          : characters.length;
      if (end <= start) {
        continue;
      }

      segments.push(characters.slice(start, end).join(""));
    }

    const text = segments.join("");
    return text.trim() ? text : undefined;
  }

  private resolveAnnotationViewportRects(
    annotation: Annotation,
    locator: Locator
  ): VisibleDrawBounds {
    if (!this.book || !this.options.container) {
      return [];
    }

    const section = this.book.sections[locator.spineIndex];
    if (!section) {
      return [];
    }

    const textRange = annotation.textRange
      ? this.normalizeTextRangeForSection(
          locator.spineIndex,
          annotation.textRange
        )
      : this.resolveFullBlockTextRange(section, locator.blockId);
    if (!textRange) {
      return this.mapLocatorToViewport(locator);
    }

    const sectionElement = this.getSectionElement(section.id);
    if (sectionElement && isRenderedDomSectionElement(sectionElement)) {
      const rects = mapDomTextRangeToViewport({
        container: this.options.container,
        mode: this.mode,
        sectionElement,
        textRange
      });
      if (rects.length > 0) {
        return rects;
      }
    }

    const canvasRects = this.resolveCanvasTextRangeViewportRects(
      section.id,
      textRange
    );
    return canvasRects.length > 0
      ? canvasRects
      : this.mapLocatorToViewport(locator);
  }

  private resolveCanvasTextRangeViewportRects(
    sectionId: string,
    textRange: TextRangeSelector
  ): VisibleDrawBounds {
    if (!this.options.container) {
      return [];
    }

    const startPosition = resolveCanvasTextPosition({
      container: this.options.container,
      sectionId,
      blockId: textRange.start.blockId,
      inlineOffset: textRange.start.inlineOffset,
      bias: "start"
    });
    const endPosition = resolveCanvasTextPosition({
      container: this.options.container,
      sectionId,
      blockId: textRange.end.blockId,
      inlineOffset: textRange.end.inlineOffset,
      bias: "end"
    });
    if (!startPosition || !endPosition) {
      return [];
    }

    const range = document.createRange();
    range.setStart(startPosition.node, startPosition.offset);
    range.setEnd(endPosition.node, endPosition.offset);
    const containerRect = this.options.container.getBoundingClientRect();
    return Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        x: rect.left - containerRect.left + this.options.container!.scrollLeft,
        y:
          this.mode === "scroll"
            ? rect.top - containerRect.top + this.options.container!.scrollTop
            : rect.top - containerRect.top,
        width: rect.width,
        height: rect.height
      }));
  }

  private resolveAnnotationSelectionAtPoint(
    point: Point
  ): ReaderTextSelectionSnapshot | null {
    if (!this.book) {
      return null;
    }

    for (let index = this.annotations.length - 1; index >= 0; index -= 1) {
      const annotation = this.annotations[index];
      if (!annotation) {
        continue;
      }

      const resolved = this.resolveAnnotationRange(annotation);
      if (!resolved) {
        continue;
      }

      const rects = this.resolveAnnotationViewportRects(
        annotation,
        resolved.locator
      );
      const hit = rects.some(
        (rect) =>
          point.x >= rect.x &&
          point.x <= rect.x + rect.width &&
          point.y >= rect.y &&
          point.y <= rect.y + rect.height
      );
      if (!hit) {
        continue;
      }

      const text =
        annotation.quote ??
        this.resolveTextRangeQuote(
          this.book.sections[resolved.spineIndex]!,
          resolved.range
        );
      return {
        text: text ?? "",
        locator: normalizeLocator({
          ...resolved.locator,
          blockId: resolved.range.start.blockId,
          inlineOffset: resolved.range.start.inlineOffset
        }),
        sectionId: resolved.sectionId,
        blockId: resolved.range.start.blockId,
        textRange: cloneTextRangeSelector(resolved.range),
        rects,
        visible: rects.length > 0
      };
    }

    return null;
  }

  private syncTextSelectionState(): void {
    this.updateTextSelectionSnapshot(
      this.resolveCurrentTextSelectionSnapshot()
    );
  }

  private updateTextSelectionSnapshot(
    selection: ReaderTextSelectionSnapshot | null
  ): void {
    if (
      readerTextSelectionSnapshotsEqual(this.textSelectionSnapshot, selection)
    ) {
      return;
    }

    this.textSelectionSnapshot = cloneReaderTextSelectionSnapshot(selection);
    const payload = {
      selection: cloneReaderTextSelectionSnapshot(this.textSelectionSnapshot)
    } satisfies ReaderEventMap["textSelectionChanged"];
    this.events.emit("textSelectionChanged", payload);
    void this.options.onTextSelectionChanged?.(payload);
  }
}

type ResolvedAnnotationRange = {
  annotation: Annotation;
  locator: Locator;
  spineIndex: number;
  sectionId: string;
  range: TextRangeSelector;
};

type SectionTextRangeContext = {
  blockIds: string[];
  blockTexts: Map<string, string>;
  blockTextLengths: Map<string, number>;
  blockOffsets: Map<string, number>;
  totalLength: number;
};

type FlattenedTextRange = {
  start: number;
  end: number;
};

function cloneReaderPreferences(
  preferences: ReaderPreferences
): ReaderPreferences {
  return {
    ...(preferences.mode ? { mode: preferences.mode } : {}),
    ...(preferences.publisherStyles
      ? { publisherStyles: preferences.publisherStyles }
      : {}),
    ...(preferences.experimentalRtl !== undefined
      ? { experimentalRtl: preferences.experimentalRtl }
      : {}),
    ...(preferences.spreadMode ? { spreadMode: preferences.spreadMode } : {}),
    ...(preferences.theme ? { theme: { ...preferences.theme } } : {}),
    ...(preferences.typography
      ? { typography: { ...preferences.typography } }
      : {})
  };
}

function themesEqual(left: Theme, right: Theme): boolean {
  return left.background === right.background && left.color === right.color;
}

function typographyEqual(
  left: TypographyOptions,
  right: TypographyOptions
): boolean {
  return (
    left.fontSize === right.fontSize &&
    left.lineHeight === right.lineHeight &&
    left.paragraphSpacing === right.paragraphSpacing &&
    left.fontFamily === right.fontFamily &&
    left.letterSpacing === right.letterSpacing &&
    left.wordSpacing === right.wordSpacing
  );
}

function hasActiveTextSelection(scope?: Node | null): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.getSelection !== "function"
  ) {
    return false;
  }

  const selection = window.getSelection();
  if (!selection || !selection.toString().trim()) {
    return false;
  }

  if (!scope) {
    return true;
  }

  const anchorNode = selection.anchorNode;
  const focusNode = selection.focusNode;
  return Boolean(
    (anchorNode && scope.contains(anchorNode)) ||
    (focusNode && scope.contains(focusNode))
  );
}

function resolveDomTextOffsetWithinBlock(
  blockElement: HTMLElement,
  node: Node | null,
  offset: number
): number {
  const safeOffset = Math.max(0, Math.trunc(offset));
  const textNodes = collectTextNodes(blockElement);
  if (textNodes.length === 0) {
    return safeOffset;
  }

  let cursor = 0;
  for (const textNode of textNodes) {
    const length = textNode.textContent?.length ?? 0;
    if (textNode === node) {
      return cursor + Math.min(length, safeOffset);
    }
    cursor += length;
  }

  const ownerTextNode =
    node?.nodeType === Node.TEXT_NODE ? node : node?.firstChild;
  if (ownerTextNode && ownerTextNode.nodeType === Node.TEXT_NODE) {
    const matchingIndex = textNodes.indexOf(ownerTextNode as Text);
    if (matchingIndex >= 0) {
      const priorLength = textNodes
        .slice(0, matchingIndex)
        .reduce(
          (total, textNode) => total + (textNode.textContent?.length ?? 0),
          0
        );
      const localLength = ownerTextNode.textContent?.length ?? 0;
      return priorLength + Math.min(localLength, safeOffset);
    }
  }

  return Math.min(cursor, safeOffset);
}

function collectTextNodes(root: Node): Text[] {
  if (typeof document === "undefined") {
    return [];
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    if (current instanceof Text) {
      textNodes.push(current);
    }
    current = walker.nextNode();
  }
  return textNodes;
}

function measurePaginatedDomPageOffsets(
  sectionElement: HTMLElement,
  pageHeight: number
): number[] {
  const sectionHeight = Math.max(
    pageHeight,
    sectionElement.scrollHeight || sectionElement.offsetHeight || pageHeight
  );
  const maxOffset = Math.max(0, sectionHeight - pageHeight);
  const lineBands = collectPaginatedDomReadableLineBands(sectionElement);
  if (lineBands.length === 0) {
    const offsets = [0];
    for (
      let offset = pageHeight;
      offset < sectionHeight;
      offset += pageHeight
    ) {
      offsets.push(offset);
    }
    return offsets;
  }

  const offsets = [0];
  let currentOffset = 0;
  while (currentOffset < maxOffset - 0.5) {
    const pageBottom = currentOffset + pageHeight;
    const lastFullyVisibleLine = [...lineBands]
      .reverse()
      .find(
        (band) =>
          band.top >= currentOffset - 0.5 && band.bottom <= pageBottom + 0.5
      );
    const nextLine = lastFullyVisibleLine
      ? lineBands.find((band) => band.top >= lastFullyVisibleLine.bottom - 0.5)
      : lineBands.find((band) => band.top > currentOffset + 0.5);
    const fallbackOffset = Math.min(sectionHeight, currentOffset + pageHeight);
    const nextOffset = Math.min(
      sectionHeight,
      Math.max(currentOffset + 1, nextLine?.top ?? fallbackOffset)
    );
    if (nextOffset <= currentOffset + 0.5) {
      break;
    }
    offsets.push(nextOffset);
    currentOffset = nextOffset;
  }

  return offsets;
}

function collectPaginatedDomReadableLineBands(
  sectionElement: HTMLElement
): Array<{ top: number; bottom: number }> {
  if (typeof document === "undefined") {
    return [];
  }

  const sectionRect = sectionElement.getBoundingClientRect();
  const bands = new Map<string, { top: number; bottom: number }>();
  for (const element of collectDomReadableBlockElements(sectionElement)) {
    const hasText = collectTextNodes(element).some((textNode) =>
      (textNode.textContent ?? "").trim()
    );
    const rects = hasText
      ? measureDomRangeLineBands(element)
      : [element.getBoundingClientRect()];

    for (const rect of rects) {
      if (rect.height <= 0 || rect.width <= 0) {
        continue;
      }
      const top = Math.max(0, rect.top - sectionRect.top);
      const bottom = Math.max(top, rect.bottom - sectionRect.top);
      const key = `${top.toFixed(2)}:${bottom.toFixed(2)}`;
      if (!bands.has(key)) {
        bands.set(key, { top, bottom });
      }
    }
  }

  for (const element of collectDomMediaElements(sectionElement)) {
    const rect = element.getBoundingClientRect();
    if (rect.height <= 0 || rect.width <= 0) {
      continue;
    }
    const top = Math.max(0, rect.top - sectionRect.top);
    const bottom = Math.max(top, rect.bottom - sectionRect.top);
    const key = `${top.toFixed(2)}:${bottom.toFixed(2)}`;
    if (!bands.has(key)) {
      bands.set(key, { top, bottom });
    }
  }

  return [...bands.values()].sort((left, right) =>
    left.top === right.top ? left.bottom - right.bottom : left.top - right.top
  );
}

function measureDomRangeLineBands(root: HTMLElement): DOMRect[] {
  if (typeof document === "undefined") {
    return [];
  }

  const range = document.createRange();
  range.selectNodeContents(root);
  return typeof range.getClientRects === "function"
    ? Array.from(range.getClientRects())
    : [];
}

function resolvePaginatedDomPageIndex(
  offsetTop: number,
  pageOffsets: number[]
): number {
  for (let index = pageOffsets.length - 1; index >= 0; index -= 1) {
    const candidate = pageOffsets[index];
    if (typeof candidate === "number" && offsetTop >= candidate - 0.5) {
      return index;
    }
  }

  return 0;
}

function getScopedTextSelectionRecord(scope: Node): {
  selection: Selection;
  range: Range | null;
  text: string;
  startNode: Node | null;
  endNode: Node | null;
} | null {
  if (
    typeof window === "undefined" ||
    typeof window.getSelection !== "function"
  ) {
    return null;
  }

  const selection = window.getSelection();
  const text = selection?.toString().trim();
  if (!selection || !text) {
    return null;
  }

  const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const startNode = range?.startContainer ?? selection.anchorNode;
  const endNode = range?.endContainer ?? selection.focusNode;
  if (
    !(
      (startNode && scope.contains(startNode)) ||
      (endNode && scope.contains(endNode))
    )
  ) {
    return null;
  }

  return {
    selection,
    range,
    text,
    startNode: startNode ?? null,
    endNode: endNode ?? null
  };
}

function measureSelectionRectsWithinContainer(input: {
  container: HTMLElement;
  selection: Selection;
  fallbackElement?: HTMLElement | null;
  mode: ReadingMode;
}): VisibleDrawBounds {
  const rangeRects =
    input.selection.rangeCount > 0
      ? Array.from(input.selection.getRangeAt(0).getClientRects())
      : [];
  const rects = rangeRects
    .map((rect) =>
      projectClientRectIntoContainer(rect, input.container, input.mode)
    )
    .filter((rect): rect is Rect => Boolean(rect));

  if (rects.length > 0) {
    return rects;
  }

  if (!input.fallbackElement) {
    return [];
  }

  const fallbackRect = projectClientRectIntoContainer(
    input.fallbackElement.getBoundingClientRect(),
    input.container,
    input.mode
  );
  return fallbackRect ? [fallbackRect] : [];
}

function projectClientRectIntoContainer(
  rect: DOMRect | DOMRectReadOnly,
  container: HTMLElement,
  mode: ReadingMode
): Rect | null {
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  const containerRect = container.getBoundingClientRect();
  return {
    x: rect.left - containerRect.left + container.scrollLeft,
    y:
      mode === "scroll"
        ? rect.top - containerRect.top + container.scrollTop
        : rect.top - containerRect.top,
    width: rect.width,
    height: rect.height
  };
}

function cloneReaderTextSelectionSnapshot(
  selection: ReaderTextSelectionSnapshot | null
): ReaderTextSelectionSnapshot | null {
  if (!selection) {
    return null;
  }

  return {
    text: selection.text,
    locator: { ...selection.locator },
    sectionId: selection.sectionId,
    ...(selection.blockId ? { blockId: selection.blockId } : {}),
    ...(selection.textRange
      ? { textRange: cloneTextRangeSelector(selection.textRange) }
      : {}),
    rects: selection.rects.map((rect) => ({ ...rect })),
    visible: selection.visible
  };
}

function readerTextSelectionSnapshotsEqual(
  left: ReaderTextSelectionSnapshot | null,
  right: ReaderTextSelectionSnapshot | null
): boolean {
  if (!left || !right) {
    return left === right;
  }

  if (
    left.text !== right.text ||
    left.sectionId !== right.sectionId ||
    left.blockId !== right.blockId ||
    left.visible !== right.visible
  ) {
    return false;
  }

  if (
    !locatorsEqual(left.locator, right.locator) ||
    left.rects.length !== right.rects.length
  ) {
    return false;
  }

  if (!textRangesEqual(left.textRange, right.textRange)) {
    return false;
  }

  return left.rects.every((rect, index) =>
    rectsEqual(rect, right.rects[index] ?? null)
  );
}

function locatorsEqual(left: Locator, right: Locator): boolean {
  return (
    left.spineIndex === right.spineIndex &&
    left.blockId === right.blockId &&
    left.anchorId === right.anchorId &&
    left.inlineOffset === right.inlineOffset &&
    left.cfi === right.cfi &&
    left.progressInSection === right.progressInSection
  );
}

function rectsEqual(left: Rect, right: Rect | null): boolean {
  if (!right) {
    return false;
  }

  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function textRangesEqual(
  left: TextRangeSelector | undefined,
  right: TextRangeSelector | undefined
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return (
    left.start.blockId === right.start.blockId &&
    left.start.inlineOffset === right.start.inlineOffset &&
    left.end.blockId === right.end.blockId &&
    left.end.inlineOffset === right.end.inlineOffset
  );
}

function cloneTextRangeSelector(
  textRange: TextRangeSelector
): TextRangeSelector {
  return {
    start: {
      blockId: textRange.start.blockId,
      inlineOffset: textRange.start.inlineOffset
    },
    end: {
      blockId: textRange.end.blockId,
      inlineOffset: textRange.end.inlineOffset
    }
  };
}

function normalizeTextRangeForContext(input: {
  textRange: TextRangeSelector;
  context: SectionTextRangeContext;
  resolveBlockId?: (blockId: string) => string;
}): TextRangeSelector | null {
  const normalizePoint = (
    point: TextRangeSelector["start"]
  ): TextRangeSelector["start"] | null => {
    const blockId = input.resolveBlockId?.(point.blockId) ?? point.blockId;
    if (!input.context.blockTextLengths.has(blockId)) {
      return null;
    }

    const length = input.context.blockTextLengths.get(blockId) ?? 0;
    return {
      blockId,
      inlineOffset: Math.max(
        0,
        Math.min(length, Math.trunc(point.inlineOffset))
      )
    };
  };

  const start = normalizePoint(input.textRange.start);
  const end = normalizePoint(input.textRange.end);
  if (!start || !end) {
    return null;
  }

  const normalized = normalizeTextRangeSelector({
    start,
    end
  });
  const flattened = flattenTextRange(normalized, input.context);
  if (!flattened) {
    return null;
  }

  return inflateFlattenedTextRange(flattened, input.context);
}

function flattenTextRange(
  textRange: TextRangeSelector,
  context: SectionTextRangeContext
): FlattenedTextRange | null {
  const startBlockOffset = context.blockOffsets.get(textRange.start.blockId);
  const endBlockOffset = context.blockOffsets.get(textRange.end.blockId);
  if (startBlockOffset === undefined || endBlockOffset === undefined) {
    return null;
  }

  const start = startBlockOffset + textRange.start.inlineOffset;
  const end = endBlockOffset + textRange.end.inlineOffset;
  const normalizedStart = Math.max(0, Math.min(start, end));
  const normalizedEnd = Math.max(normalizedStart, Math.max(start, end));
  return {
    start: normalizedStart,
    end: normalizedEnd
  };
}

function inflateFlattenedTextRange(
  flattened: FlattenedTextRange,
  context: SectionTextRangeContext
): TextRangeSelector | null {
  const start = resolveTextRangePointFromAbsoluteOffset(
    flattened.start,
    context,
    "start"
  );
  const end = resolveTextRangePointFromAbsoluteOffset(
    flattened.end,
    context,
    "end"
  );
  if (!start || !end) {
    return null;
  }

  return {
    start,
    end
  };
}

function resolveTextRangePointFromAbsoluteOffset(
  absoluteOffset: number,
  context: SectionTextRangeContext,
  bias: "start" | "end"
): TextRangeSelector["start"] | null {
  const clampedOffset = Math.max(
    0,
    Math.min(context.totalLength, Math.trunc(absoluteOffset))
  );
  for (let index = 0; index < context.blockIds.length; index += 1) {
    const blockId = context.blockIds[index];
    if (!blockId) {
      continue;
    }

    const blockStart = context.blockOffsets.get(blockId) ?? 0;
    const blockLength = context.blockTextLengths.get(blockId) ?? 0;
    const blockEnd = blockStart + blockLength;
    const isLastBlock = index === context.blockIds.length - 1;

    if (
      clampedOffset < blockEnd ||
      (isLastBlock && clampedOffset <= blockEnd)
    ) {
      return {
        blockId,
        inlineOffset: clampedOffset - blockStart
      };
    }

    if (clampedOffset === blockEnd && bias === "end") {
      return {
        blockId,
        inlineOffset: blockLength
      };
    }
  }

  const lastBlockId = context.blockIds.at(-1);
  if (!lastBlockId) {
    return null;
  }

  return {
    blockId: lastBlockId,
    inlineOffset: context.blockTextLengths.get(lastBlockId) ?? 0
  };
}

function subtractFlattenedRange(
  source: FlattenedTextRange,
  subtractor: FlattenedTextRange
): FlattenedTextRange[] {
  const overlapStart = Math.max(source.start, subtractor.start);
  const overlapEnd = Math.min(source.end, subtractor.end);
  if (overlapEnd <= overlapStart) {
    return [source];
  }

  const remaining: FlattenedTextRange[] = [];
  if (source.start < overlapStart) {
    remaining.push({
      start: source.start,
      end: overlapStart
    });
  }
  if (overlapEnd < source.end) {
    remaining.push({
      start: overlapEnd,
      end: source.end
    });
  }
  return remaining;
}

function resolveLeadingSelectionTarget<
  TTarget extends { element: HTMLElement }
>(left: TTarget | null, right: TTarget | null): TTarget | null {
  if (left && !right) {
    return left;
  }

  if (right && !left) {
    return right;
  }

  if (!left || !right) {
    return null;
  }

  if (left.element === right.element) {
    return left;
  }

  const position = left.element.compareDocumentPosition(right.element);
  if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
    return left;
  }

  if (position & Node.DOCUMENT_POSITION_PRECEDING) {
    return right;
  }

  return left;
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(value, 1));
}

function resolveCanvasTextPosition(input: {
  container: HTMLElement;
  sectionId: string;
  blockId: string;
  inlineOffset: number;
  bias: "start" | "end";
}): { node: Text; offset: number } | null {
  const selectorValue = escapeAttributeSelectorValue(input.blockId);
  const runs = Array.from(
    input.container.querySelectorAll<HTMLElement>(
      `.epub-text-run[data-reader-section-id="${escapeAttributeSelectorValue(
        input.sectionId
      )}"][data-reader-block-id="${selectorValue}"]`
    )
  );
  if (runs.length === 0) {
    return null;
  }

  const clampedOffset = Math.max(0, Math.trunc(input.inlineOffset));
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index];
    if (!run) {
      continue;
    }

    const runStart =
      Number.parseInt(run.dataset.readerInlineStart ?? "0", 10) || 0;
    const fallbackTextLength = Array.from(run.textContent ?? "").length;
    const runEnd =
      Number.parseInt(
        run.dataset.readerInlineEnd ?? `${runStart + fallbackTextLength}`,
        10
      ) || runStart + fallbackTextLength;
    const isBoundary = clampedOffset === runEnd;
    const matches =
      clampedOffset < runEnd ||
      (clampedOffset === runStart && input.bias === "start") ||
      (isBoundary && (input.bias === "end" || index === runs.length - 1));
    if (!matches) {
      continue;
    }

    const textNode = run.firstChild;
    if (!(textNode instanceof Text)) {
      return null;
    }

    const localOffset =
      input.bias === "end" && clampedOffset >= runEnd
        ? (textNode.textContent?.length ?? 0)
        : Math.max(
            0,
            Math.min(
              textNode.textContent?.length ?? 0,
              clampedOffset - runStart
            )
          );
    return {
      node: textNode,
      offset: localOffset
    };
  }

  const lastRun = runs.at(-1);
  const textNode = lastRun?.firstChild;
  return textNode instanceof Text
    ? {
        node: textNode,
        offset: textNode.textContent?.length ?? 0
      }
    : null;
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
  return (
    element.matches(".epub-dom-section") ||
    Boolean(element.querySelector(".epub-dom-section"))
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(
    target.closest("input, textarea, select, button, [contenteditable='true']")
  );
}

function annotateDomSectionWithBlockIds(
  section: SectionDocument,
  sectionElement: HTMLElement
): void {
  for (const element of sectionElement.querySelectorAll<HTMLElement>(
    "[data-reader-block-id]"
  )) {
    delete element.dataset.readerBlockId;
  }

  const elements = collectDomReadableBlockElements(sectionElement);
  const blocks = collectSelectableBlocksInReadingOrder(section.blocks).map(
    (block) => ({
      id: block.id,
      text: normalizeBlockMatchText(collectBlockText(block))
    })
  );

  let searchStartIndex = 0;
  for (const element of elements) {
    if (element.id.trim()) {
      element.dataset.readerBlockId = element.id.trim();
      continue;
    }

    const elementText = normalizeBlockMatchText(element.textContent ?? "");
    if (!elementText) {
      continue;
    }

    const matchIndex = findMatchingSelectableBlockIndex(
      blocks,
      elementText,
      searchStartIndex
    );
    if (matchIndex < 0) {
      continue;
    }

    element.dataset.readerBlockId = blocks[matchIndex]!.id;
    searchStartIndex = matchIndex + 1;
  }
}

function collectDomReadableBlockElements(
  sectionElement: HTMLElement
): HTMLElement[] {
  return Array.from(
    sectionElement.querySelectorAll<HTMLElement>(
      "p, li, pre, h1, h2, h3, h4, h5, h6, td, th, dt, dd, figcaption"
    )
  );
}

function collectDomMediaElements(sectionElement: HTMLElement): HTMLElement[] {
  return Array.from(
    sectionElement.querySelectorAll<HTMLElement>(
      "img, svg, image, object, video, canvas, figure"
    )
  );
}

function collectSelectableBlocksInReadingOrder(
  blocks: BlockNode[]
): BlockNode[] {
  const collected: BlockNode[] = [];

  for (const block of blocks) {
    switch (block.kind) {
      case "heading":
      case "text":
      case "code":
        collected.push(block);
        break;
      case "quote":
      case "aside":
      case "nav":
        collected.push(...collectSelectableBlocksInReadingOrder(block.blocks));
        break;
      case "figure":
        collected.push(...collectSelectableBlocksInReadingOrder(block.blocks));
        if (block.caption) {
          collected.push(
            ...collectSelectableBlocksInReadingOrder(block.caption)
          );
        }
        break;
      case "list":
        for (const item of block.items) {
          collected.push(...collectSelectableBlocksInReadingOrder(item.blocks));
        }
        break;
      case "table":
        if (block.caption) {
          collected.push(
            ...collectSelectableBlocksInReadingOrder(block.caption)
          );
        }
        for (const row of block.rows) {
          for (const cell of row.cells) {
            collected.push(
              ...collectSelectableBlocksInReadingOrder(cell.blocks)
            );
          }
        }
        break;
      case "definition-list":
        for (const item of block.items) {
          collected.push(...collectSelectableBlocksInReadingOrder(item.term));
          for (const description of item.descriptions) {
            collected.push(
              ...collectSelectableBlocksInReadingOrder(description)
            );
          }
        }
        break;
      default:
        break;
    }
  }

  return collected;
}

function resolveSectionAnchorIdForElement(
  section: SectionDocument,
  element: HTMLElement
): string | undefined {
  const elementId = element.id.trim();
  if (elementId && section.anchors[elementId]) {
    return elementId;
  }

  const namedAnchor = element.getAttribute("name")?.trim();
  if (namedAnchor && section.anchors[namedAnchor]) {
    return namedAnchor;
  }

  if (elementId) {
    const resolvedAnchor = Object.entries(section.anchors).find(
      ([, blockId]) => blockId === elementId
    )?.[0];
    if (resolvedAnchor) {
      return resolvedAnchor;
    }
  }

  return undefined;
}

function normalizeBlockMatchText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function findMatchingSelectableBlockIndex(
  blocks: Array<{ id: string; text: string }>,
  elementText: string,
  searchStartIndex: number
): number {
  for (let index = searchStartIndex; index < blocks.length; index += 1) {
    const candidate = blocks[index];
    if (!candidate?.text) {
      continue;
    }

    if (candidate.text === elementText) {
      return index;
    }

    const shortestLength = Math.min(candidate.text.length, elementText.length);
    if (
      shortestLength >= 12 &&
      (candidate.text.includes(elementText) ||
        elementText.includes(candidate.text))
    ) {
      return index;
    }
  }

  return -1;
}

function findBlockById(blocks: BlockNode[], blockId: string): BlockNode | null {
  for (const block of blocks) {
    if (block.id === blockId) {
      return block;
    }

    const nested = findNestedBlockById(block, blockId);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function escapeAttributeSelectorValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function resolveRenderableBlockId(
  blocks: BlockNode[],
  blockId: string
): string | undefined {
  for (const block of blocks) {
    if (block.id === blockId) {
      return block.id;
    }

    if (findNestedBlockById(block, blockId)) {
      return block.id;
    }
  }

  return undefined;
}

function findNestedBlockById(
  block: BlockNode,
  blockId: string
): BlockNode | null {
  switch (block.kind) {
    case "quote":
    case "aside":
    case "nav":
    case "figure":
      return findBlockById(
        block.kind === "figure"
          ? [...block.blocks, ...(block.caption ?? [])]
          : block.blocks,
        blockId
      );
    case "list":
      for (const item of block.items) {
        const nested = findBlockById(item.blocks, blockId);
        if (nested) {
          return nested;
        }
      }
      return null;
    case "table":
      for (const candidate of [
        ...(block.caption ?? []),
        ...block.rows.flatMap((row) => row.cells.flatMap((cell) => cell.blocks))
      ]) {
        if (candidate.id === blockId) {
          return candidate;
        }
        const nested = findNestedBlockById(candidate, blockId);
        if (nested) {
          return nested;
        }
      }
      return null;
    case "definition-list":
      for (const item of block.items) {
        const nested = findBlockById(
          [
            ...item.term,
            ...item.descriptions.flatMap((description) => description)
          ],
          blockId
        );
        if (nested) {
          return nested;
        }
      }
      return null;
    default:
      return null;
  }
}
