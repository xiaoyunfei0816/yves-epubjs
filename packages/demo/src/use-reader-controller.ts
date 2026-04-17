import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction
} from "react"
import {
  EpubReader,
  type PaginationInfo,
  type RenderDiagnostics,
  type SearchResult,
  type Theme,
  type TocItem,
  type VisibleSectionDiagnostics
} from "../../core/src/index"
import { findActiveTocId } from "./toc-active"

export type ReaderSnapshot = {
  metaText: string
  pagination: PaginationInfo
  toc: TocItem[]
  renderBackend: "canvas" | "dom" | null
  diagnostics: RenderDiagnostics | null
  visibleSectionDiagnostics: VisibleSectionDiagnostics[]
}

export const THEMES = {
  paper: {
    background: "#fffaf0",
    color: "#1f2328"
  },
  night: {
    background: "#182028",
    color: "#ecf4ff"
  },
  sage: {
    background: "#eef4ea",
    color: "#203126"
  }
} as const satisfies Record<string, Theme>

type ThemeKey = keyof typeof THEMES

const INITIAL_SNAPSHOT: ReaderSnapshot = {
  metaText: "No book loaded",
  pagination: {
    currentPage: 1,
    totalPages: 1
  },
  toc: [],
  renderBackend: null,
  diagnostics: null,
  visibleSectionDiagnostics: []
}

export function useReaderController(
  containerRef: RefObject<HTMLDivElement | null>
): {
  snapshot: ReaderSnapshot
  results: SearchResult[]
  themeKey: ThemeKey
  mode: "scroll" | "paginated"
  fontSize: number
  pageValue: string
  activeTocId: string | null
  expandedTocIds: Set<string>
  lightbox: { src: string; alt: string } | null
  setPageValue: (value: string) => void
  setExpandedTocIds: Dispatch<SetStateAction<Set<string>>>
  setLightbox: Dispatch<SetStateAction<{ src: string; alt: string } | null>>
  clearSearchResults: () => void
  openFile: (file: File) => Promise<void>
  goToPage: (page: number) => Promise<void>
  performSearch: (query: string) => Promise<void>
  goToSearchResult: (result: SearchResult) => Promise<void>
  handleThemeChange: (nextThemeKey: ThemeKey) => Promise<void>
  handleModeChange: (nextMode: "scroll" | "paginated") => Promise<void>
  handleFontSizeChange: (nextSize: number) => Promise<void>
  goToPreviousPage: () => Promise<void>
  goToNextPage: () => Promise<void>
  goToTocItem: (id: string) => Promise<void>
} {
  const readerRef = useRef<EpubReader | null>(null)
  const activeTocIdRef = useRef<string | null>(null)

  const [snapshot, setSnapshot] = useState<ReaderSnapshot>(INITIAL_SNAPSHOT)
  const [results, setResults] = useState<SearchResult[]>([])
  const [themeKey, setThemeKey] = useState<ThemeKey>("paper")
  const [mode, setMode] = useState<"scroll" | "paginated">("scroll")
  const [fontSize, setFontSize] = useState(18)
  const [pageValue, setPageValue] = useState("1")
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null)
  const [expandedTocIds, setExpandedTocIds] = useState<Set<string>>(new Set())
  const [activeTocId, setActiveTocId] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const reader = new EpubReader({ container })
    readerRef.current = reader

    const syncSnapshot = (): void => {
      const book = reader.getBook()
      const locator = reader.getCurrentLocation()
      const metrics = reader.getRenderMetrics()
      const diagnostics = reader.getRenderDiagnostics()
      const visibleSectionDiagnostics = reader.getVisibleSectionDiagnostics()

      if (!book || !locator) {
        setSnapshot({
          metaText: "No book loaded",
          pagination: reader.getPaginationInfo(),
          toc: book?.toc ?? [],
          renderBackend: metrics.backend,
          diagnostics,
          visibleSectionDiagnostics
        })
        setPageValue("1")
        return
      }

      const section = book.sections[locator.spineIndex]
      const pagination = reader.getPaginationInfo()
      const nextActiveTocId = findActiveTocId(
        book.toc,
        section?.href ?? "",
        activeTocIdRef.current
      )
      setSnapshot({
        metaText: `${book.metadata.title} · ${section?.title ?? section?.href ?? "Section"} · ${
          locator.spineIndex + 1
        } / ${book.sections.length} · Page ${pagination.currentPage} / ${pagination.totalPages} · ${metrics.backend}`,
        pagination,
        toc: book.toc,
        renderBackend: metrics.backend,
        diagnostics,
        visibleSectionDiagnostics
      })
      activeTocIdRef.current = nextActiveTocId
      setActiveTocId(nextActiveTocId)
      if (nextActiveTocId) {
        setExpandedTocIds((current) => expandAncestors(current, book.toc, nextActiveTocId))
      }
      setPageValue(String(pagination.currentPage))
    }

    const offOpened = reader.on("opened", ({ book }) => {
      setResults([])
      setExpandedTocIds(new Set(flattenBranchIds(book.toc)))
      activeTocIdRef.current = null
      setActiveTocId(null)
      setSnapshot((current) => ({
        ...current,
        toc: book.toc
      }))
      syncSnapshot()
    })
    const offRelocated = reader.on("relocated", syncSnapshot)
    const offRendered = reader.on("rendered", syncSnapshot)
    const offTypography = reader.on("typographyChanged", syncSnapshot)
    const offSearch = reader.on("searchCompleted", ({ results: nextResults }) => {
      setResults(nextResults)
    })

    const handleReaderClick = (event: MouseEvent): void => {
      const rect = container.getBoundingClientRect()
      const hit = reader.hitTest({
        x: event.clientX - rect.left + container.scrollLeft,
        y: event.clientY - rect.top
      })
      if (!hit || hit.kind !== "image") {
        return
      }

      setLightbox({
        src: hit.src,
        alt: hit.alt ?? ""
      })
    }

    container.addEventListener("click", handleReaderClick)
    syncSnapshot()

    return () => {
      container.removeEventListener("click", handleReaderClick)
      offSearch()
      offTypography()
      offRendered()
      offRelocated()
      offOpened()
      reader.destroy()
      readerRef.current = null
    }
  }, [containerRef])

  async function openFile(file: File): Promise<void> {
    const reader = readerRef.current
    if (!reader) {
      return
    }

    setSnapshot((current) => ({
      ...current,
      metaText: "Opening EPUB..."
    }))
    await reader.setTheme(THEMES[themeKey])
    await reader.setTypography({ fontSize })
    await reader.setMode(mode)
    await reader.open(file)
    await reader.render()
    await reader.goToLocation({
      spineIndex: 0,
      progressInSection: 0
    })
  }

  async function goToPage(page: number): Promise<void> {
    const reader = readerRef.current
    if (!reader || !Number.isFinite(page)) {
      return
    }

    await reader.goToPage(page)
  }

  async function performSearch(query: string): Promise<void> {
    const reader = readerRef.current
    if (!reader) {
      return
    }

    const normalized = query.trim()
    if (!normalized) {
      setResults([])
      return
    }

    const nextResults = await reader.search(normalized)
    if (nextResults.length === 0) {
      setResults([])
    }
  }

  async function goToSearchResult(result: SearchResult): Promise<void> {
    await readerRef.current?.goToSearchResult(result)
  }

  async function handleThemeChange(nextThemeKey: ThemeKey): Promise<void> {
    setThemeKey(nextThemeKey)
    await readerRef.current?.setTheme(THEMES[nextThemeKey])
  }

  async function handleModeChange(nextMode: "scroll" | "paginated"): Promise<void> {
    setMode(nextMode)
    await readerRef.current?.setMode(nextMode)
  }

  async function handleFontSizeChange(nextSize: number): Promise<void> {
    setFontSize(nextSize)
    await readerRef.current?.setTypography({ fontSize: nextSize })
  }

  async function goToPreviousPage(): Promise<void> {
    await readerRef.current?.prev()
  }

  async function goToNextPage(): Promise<void> {
    await readerRef.current?.next()
  }

  async function goToTocItem(id: string): Promise<void> {
    setActiveTocId(id)
    activeTocIdRef.current = id
    setExpandedTocIds((current) => expandAncestors(current, snapshot.toc, id))
    await readerRef.current?.goToTocItem(id)
  }

  function clearSearchResults(): void {
    setResults([])
  }

  return {
    snapshot,
    results,
    themeKey,
    mode,
    fontSize,
    pageValue,
    activeTocId,
    expandedTocIds,
    lightbox,
    setPageValue,
    setExpandedTocIds,
    setLightbox,
    clearSearchResults,
    openFile,
    goToPage,
    performSearch,
    goToSearchResult,
    handleThemeChange,
    handleModeChange,
    handleFontSizeChange,
    goToPreviousPage,
    goToNextPage,
    goToTocItem
  }
}

function flattenBranchIds(items: TocItem[]): string[] {
  return items.flatMap((item) => [
    ...(item.children.length > 0 ? [item.id] : []),
    ...flattenBranchIds(item.children)
  ])
}

function findAncestorIds(items: TocItem[], targetId: string, trail: string[] = []): string[] | null {
  for (const item of items) {
    if (item.id === targetId) {
      return trail
    }

    const nested = findAncestorIds(item.children, targetId, [...trail, item.id])
    if (nested) {
      return nested
    }
  }

  return null
}

function expandAncestors(current: Set<string>, items: TocItem[], targetId: string): Set<string> {
  const next = new Set(current)
  const ancestors = findAncestorIds(items, targetId) ?? []
  for (const id of ancestors) {
    next.add(id)
  }
  return next
}
