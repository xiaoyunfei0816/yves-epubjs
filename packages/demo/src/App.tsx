import { useRef, useState } from "react"
import {
  CustomSelect,
  ReaderDiagnosticsPanel,
  ReaderSidebar,
  ReaderToolbar,
  SearchResultsPanel,
  toggleId
} from "./reader-ui"
import { THEMES, useReaderController } from "./use-reader-controller"

export function App(): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedFileName, setSelectedFileName] = useState("No file selected")
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const {
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
  } = useReaderController(containerRef)

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Pretext EPUB Reader</p>
          <h1>
              Open an EPUB and read it in the browser.
          </h1>
          <p className="hero-copy">
            This demo runs the parser/runtime pipeline with pretext-backed text layout:
            ZIP -&gt; container.xml -&gt; OPF -&gt; NAV/NCX -&gt; XHTML sections -&gt; pretext
            line layout -&gt; reader UI.
          </p>
          <SearchResultsPanel
            query={searchQuery}
            results={results}
            onSelect={async (index) => {
              await goToSearchResult(results[index]!)
            }}
          />
        </div>

        <div className="hero-panel">
            <label className="file-picker">
              <span>Select EPUB</span>
              <span className="file-picker-shell">
                <span className="file-picker-button">Choose File</span>
                <span className="file-picker-name">{selectedFileName}</span>
                <input
                  type="file"
                  accept=".epub,application/epub+zip"
                  className="file-picker-input"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    setSelectedFileName(file?.name ?? "No file selected")
                    if (file) {
                      await openFile(file)
                    }
                  }}
                />
              </span>
            </label>

            <div className="controls-stack">
              <label className="field-shell controls-search-row">
                <span className="field-label">Search</span>
                <div className="search-bar">
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    onKeyDown={async (event) => {
                      if (event.key === "Enter") {
                        await performSearch(searchQuery);
                      }
                    }}
                    placeholder="Search current book"
                    className="field-input search-input"
                  />
                  <button
                    type="button"
                    className="search-submit"
                    onClick={() => {
                      void performSearch(searchQuery);
                    }}
                  >
                    Search
                  </button>
                  <button
                    type="button"
                    className="search-clear"
                    onClick={() => {
                      setSearchQuery("")
                      clearSearchResults()
                    }}
                  >
                    Clear
                  </button>
                </div>
              </label>
              <div className="controls-grid controls-settings-row">
                <label className="field-shell">
                  <span className="field-label">Theme</span>
                  <CustomSelect
                    value={themeKey}
                    options={[
                      { value: "paper", label: "Paper" },
                      { value: "night", label: "Night" },
                      { value: "sage", label: "Sage" }
                    ]}
                    onChange={async (value) => {
                      await handleThemeChange(value as keyof typeof THEMES)
                    }}
                  />
                </label>
                <label className="field-shell">
                  <span className="field-label">Mode</span>
                  <CustomSelect
                    value={mode}
                    options={[
                      { value: "scroll", label: "Scroll" },
                      { value: "paginated", label: "Paginated" }
                    ]}
                    onChange={async (value) => {
                      await handleModeChange(value as "scroll" | "paginated")
                    }}
                  />
                </label>
                <label className="field-shell">
                  <span className="field-label">Font Size</span>
                  <input
                    type="range"
                    min="14"
                    max="28"
                    value={fontSize}
                    onChange={async (event) =>
                      handleFontSizeChange(Number(event.target.value))
                    }
                    className="accent-amber-500"
                  />
                </label>
              </div>
            </div>
        </div>
      </section>

      <section className={`workspace${sidebarCollapsed ? " workspace-collapsed" : ""}`}>
        <ReaderSidebar
          collapsed={sidebarCollapsed}
          toc={snapshot.toc}
          activeId={activeTocId}
          expandedIds={expandedTocIds}
          onCollapse={() => setSidebarCollapsed(true)}
          onExpand={() => setSidebarCollapsed(false)}
          onToggle={(id) => {
            setExpandedTocIds((current) => toggleId(current, id))
          }}
          onSelect={async (id) => {
            await goToTocItem(id)
          }}
        />

          <section className="reader-panel">
            <div className="reader-layout">
              <div className="reader-main">
                <ReaderToolbar
                  currentPage={snapshot.pagination.currentPage}
                  totalPages={snapshot.pagination.totalPages}
                  pageValue={pageValue}
                  onPageValueChange={setPageValue}
                  onGoToPage={goToPage}
                  onPrevious={goToPreviousPage}
                  onNext={goToNextPage}
                />

                <p className="reader-meta">{snapshot.metaText}</p>

                <div className="reader-progress">
                  <input
                    type="range"
                    min="1"
                    max={snapshot.pagination.totalPages}
                    value={snapshot.pagination.currentPage}
                    onChange={async (event) => goToPage(Number(event.target.value))}
                    className="page-range"
                  />
                  <div className="page-status">
                    Page {snapshot.pagination.currentPage} / {snapshot.pagination.totalPages}
                  </div>
                </div>

                <div
                  ref={containerRef}
                  data-mode={mode}
                  className="reader-root"
                >
                  <article className="placeholder-page">
                    <h2>Waiting for an EPUB</h2>
                    <p>Select a local EPUB file to parse and render it.</p>
                  </article>
                </div>
              </div>

              <aside className="reader-side">
                <ReaderDiagnosticsPanel
                  renderBackend={snapshot.renderBackend}
                  diagnostics={snapshot.diagnostics}
                  visibleSectionDiagnostics={snapshot.visibleSectionDiagnostics}
                />
              </aside>
            </div>
          </section>
        </section>

      {lightbox ? (
        <div
          className="image-lightbox"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setLightbox(null)
            }
          }}
        >
          <button
            type="button"
            className="image-lightbox-close"
            onClick={() => setLightbox(null)}
          >
            Close
          </button>
          <img src={lightbox.src} alt={lightbox.alt} className="image-lightbox-image" />
        </div>
      ) : null}
    </main>
  )
}
