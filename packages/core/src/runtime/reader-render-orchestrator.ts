import type { LayoutResult } from "../layout/layout-engine"
import type { ChapterRenderDecision, Locator, SectionDocument } from "../model/types"

type RenderBehavior = "relocate" | "preserve"

type ScrollAnchor = {
  sectionId: string
  offsetWithinSection: number
  fallbackScrollTop: number
}

type RenderedPage = {
  pageNumber: number
  spineIndex: number
  pageNumberInSection: number
  totalPagesInSection: number
}

type ReaderRenderOrchestratorDependencies = {
  getBook: () => { sections: SectionDocument[] } | null
  getContainer: () => HTMLElement | null | undefined
  getMode: () => "scroll" | "paginated"
  getCurrentSectionIndex: () => number
  setCurrentSectionIndex: (sectionIndex: number) => void
  getSectionForRender: (section: SectionDocument) => SectionDocument
  captureScrollAnchor: () => ScrollAnchor | null
  setLastPresentationRenderSignature: (signature: string | null) => void
  resolvePresentationRenderSignature: (section: SectionDocument) => string | null
  resolveChapterRenderDecision: (sectionIndex: number) => ChapterRenderDecision
  setLastChapterRenderDecision: (
    decision: ChapterRenderDecision | null
  ) => void
  applyContainerTheme: () => void
  getPublisherStyles: () => string
  syncFixedLayoutContainerState: (value: unknown | null) => void
  nextRenderVersion: () => number
  getPaginationMeasurement: () => { width: number; height: number }
  layoutPaginatedSection: (
    section: SectionDocument,
    spineIndex: number,
    measurement: { width: number; height: number }
  ) => LayoutResult | undefined
  setMeasuredSize: (size: { width: number; height: number }) => void
  ensurePages: (layout?: LayoutResult) => void
  resolveRenderedPage: (sectionId: string) => RenderedPage | null
  renderPaginatedDomSpread: (
    page: RenderedPage,
    renderVersion: number
  ) => void
  renderDomSection: (section: SectionDocument, renderVersion: number) => void
  syncMeasuredPaginatedDomPages: (section: SectionDocument) => RenderedPage | null
  setCurrentPageNumber: (pageNumber: number) => void
  getLocator: () => Locator | null
  updateLocator: (locator: Locator) => void
  syncDomSectionStateAfterRender: (
    renderBehavior: RenderBehavior,
    preservedScrollAnchor: ScrollAnchor | null,
    resolvedPage: RenderedPage | null
  ) => void
  renderPaginatedCanvas: (
    section: SectionDocument,
    currentPage: RenderedPage | null,
    renderVersion: number
  ) => void
  getContentWidth: () => number
  getContainerClientHeight: () => number
  updateScrollWindowBounds: () => void
  renderScrollableCanvas: (renderVersion: number) => void
  scrollToCurrentLocation: () => void
  restoreScrollAnchor: (anchor: ScrollAnchor | null) => void
  scrollToLocatorAnchor: () => boolean
  syncCurrentPageFromSection: () => void
  getProgressForCurrentLocator: () => number
  clampProgress: (value: number) => number
  syncPositionFromScroll: (emitEvent: boolean) => boolean
  emitSectionRendered: (section: SectionDocument) => void
}

export class ReaderRenderOrchestrator {
  constructor(
    private readonly dependencies: ReaderRenderOrchestratorDependencies
  ) {}

  renderCurrentSection(renderBehavior: RenderBehavior = "relocate"): void {
    const book = this.dependencies.getBook()
    const container = this.dependencies.getContainer()
    if (!book || !container) {
      return
    }

    const preservedScrollAnchor =
      this.dependencies.getMode() === "scroll" && renderBehavior === "preserve"
        ? this.dependencies.captureScrollAnchor()
        : null
    if (this.dependencies.getMode() === "scroll" && renderBehavior === "preserve") {
      const anchoredSectionIndex = preservedScrollAnchor?.sectionId
        ? book.sections.findIndex(
            (candidate) => candidate.id === preservedScrollAnchor.sectionId
          )
        : -1
      if (anchoredSectionIndex >= 0) {
        this.dependencies.setCurrentSectionIndex(anchoredSectionIndex)
      }
    }

    const sourceSection = book.sections[this.dependencies.getCurrentSectionIndex()]
    const section = sourceSection
      ? this.dependencies.getSectionForRender(sourceSection)
      : null
    if (!section) {
      return
    }
    let didRender = false
    this.dependencies.setLastPresentationRenderSignature(
      this.dependencies.resolvePresentationRenderSignature(section)
    )
    const chapterRenderDecision = this.dependencies.resolveChapterRenderDecision(
      this.dependencies.getCurrentSectionIndex()
    )
    this.dependencies.setLastChapterRenderDecision(chapterRenderDecision)

    this.dependencies.applyContainerTheme()
    container.dataset.renderMode = chapterRenderDecision.mode
    container.dataset.mode = this.dependencies.getMode()
    container.dataset.publisherStyles = this.dependencies.getPublisherStyles()
    container.dataset.renditionLayout = section.renditionLayout ?? "reflowable"
    if (
      chapterRenderDecision.mode !== "dom" ||
      section.renditionLayout !== "pre-paginated"
    ) {
      this.dependencies.syncFixedLayoutContainerState(null)
    }
    const renderVersion = this.dependencies.nextRenderVersion()
    try {
      if (this.dependencies.getMode() === "paginated") {
        const paginationMeasurement = this.dependencies.getPaginationMeasurement()
        const layout =
          section.renditionLayout === "pre-paginated"
            ? undefined
            : this.dependencies.layoutPaginatedSection(
                section,
                this.dependencies.getCurrentSectionIndex(),
                paginationMeasurement
              )
        this.dependencies.setMeasuredSize(paginationMeasurement)
        this.dependencies.ensurePages(layout)
        const currentPage = this.dependencies.resolveRenderedPage(
          sourceSection?.id ?? section.id
        )
        if (chapterRenderDecision.mode === "dom") {
          if (currentPage) {
            this.dependencies.renderPaginatedDomSpread(currentPage, renderVersion)
          } else {
            this.dependencies.renderDomSection(section, renderVersion)
          }
          didRender = true
          const measuredPage =
            this.dependencies.syncMeasuredPaginatedDomPages(section)
          const resolvedPage = measuredPage ?? currentPage
          if (resolvedPage) {
            this.dependencies.setCurrentPageNumber(resolvedPage.pageNumber)
            const locator = this.dependencies.getLocator()
            if (locator) {
              this.dependencies.updateLocator({
                ...locator,
                spineIndex: resolvedPage.spineIndex,
                progressInSection:
                  resolvedPage.totalPagesInSection > 1
                    ? (resolvedPage.pageNumberInSection - 1) /
                      (resolvedPage.totalPagesInSection - 1)
                    : 0
              })
            }
          }
          this.dependencies.syncDomSectionStateAfterRender(
            renderBehavior,
            preservedScrollAnchor,
            resolvedPage
          )
          return
        }
        this.dependencies.renderPaginatedCanvas(section, currentPage, renderVersion)
        didRender = true
        if (currentPage) {
          this.dependencies.setCurrentPageNumber(currentPage.pageNumber)
          const locator = this.dependencies.getLocator()
          if (locator) {
            this.dependencies.updateLocator({
              ...locator,
              spineIndex: currentPage.spineIndex,
              progressInSection:
                currentPage.totalPagesInSection > 1
                  ? (currentPage.pageNumberInSection - 1) /
                    (currentPage.totalPagesInSection - 1)
                  : 0
            })
          }
        }
      } else {
        this.dependencies.setMeasuredSize({
          width: this.dependencies.getContentWidth(),
          height: this.dependencies.getContainerClientHeight()
        })
        this.dependencies.updateScrollWindowBounds()
        this.dependencies.renderScrollableCanvas(renderVersion)
        didRender = true
        if (renderBehavior === "relocate") {
          this.dependencies.scrollToCurrentLocation()
        } else {
          this.dependencies.restoreScrollAnchor(preservedScrollAnchor)
        }
        const locator = this.dependencies.getLocator()
        if (locator?.anchorId && this.dependencies.scrollToLocatorAnchor()) {
          this.dependencies.syncCurrentPageFromSection()
          this.dependencies.updateLocator({
            ...locator,
            spineIndex: this.dependencies.getCurrentSectionIndex(),
            progressInSection: this.dependencies.getProgressForCurrentLocator()
          })
          return
        }
        if (locator?.blockId) {
          this.dependencies.syncCurrentPageFromSection()
          this.dependencies.updateLocator({
            ...locator,
            spineIndex: this.dependencies.getCurrentSectionIndex(),
            progressInSection: this.dependencies.getProgressForCurrentLocator()
          })
          return
        }
        if (
          renderBehavior === "preserve" &&
          preservedScrollAnchor &&
          !preservedScrollAnchor.sectionId &&
          locator
        ) {
          this.dependencies.setCurrentSectionIndex(locator.spineIndex)
          this.dependencies.syncCurrentPageFromSection()
          this.dependencies.updateLocator({
            ...locator,
            spineIndex: this.dependencies.getCurrentSectionIndex(),
            progressInSection: this.dependencies.clampProgress(
              locator.progressInSection ?? 0
            )
          })
          return
        }
        if (renderBehavior === "preserve" && !locator) {
          this.dependencies.setCurrentPageNumber(
            this.dependencies.getCurrentSectionIndex() + 1
          )
          this.dependencies.updateLocator({
            spineIndex: this.dependencies.getCurrentSectionIndex(),
            progressInSection: 0
          })
          return
        }
        if (renderBehavior === "relocate" && !locator) {
          this.dependencies.setCurrentPageNumber(
            this.dependencies.getCurrentSectionIndex() + 1
          )
          this.dependencies.updateLocator({
            spineIndex: this.dependencies.getCurrentSectionIndex(),
            progressInSection: 0
          })
          return
        }
        if (renderBehavior === "relocate" && locator) {
          this.dependencies.syncCurrentPageFromSection()
          this.dependencies.updateLocator({
            ...locator,
            spineIndex: this.dependencies.getCurrentSectionIndex(),
            progressInSection: this.dependencies.clampProgress(
              locator.progressInSection ?? 0
            )
          })
          return
        }
        if (!this.dependencies.syncPositionFromScroll(false)) {
          const nextLocator = this.dependencies.getLocator()
          this.dependencies.syncCurrentPageFromSection()
          if (nextLocator) {
            this.dependencies.updateLocator({
              ...nextLocator,
              spineIndex: this.dependencies.getCurrentSectionIndex(),
              progressInSection: this.dependencies.getProgressForCurrentLocator()
            })
          }
        }
      }
    } finally {
      if (didRender) {
        this.dependencies.emitSectionRendered(section)
      }
    }
  }
}
