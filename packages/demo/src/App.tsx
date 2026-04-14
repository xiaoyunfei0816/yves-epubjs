import { useEffect, useId, useRef, useState } from "react";
import {
  EpubReader,
  type PaginationInfo,
  type SearchResult,
  type Theme,
  type TocItem
} from "../../core/src/index";

type ReaderSnapshot = {
  metaText: string;
  pagination: PaginationInfo;
  toc: TocItem[];
};

const THEMES = {
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
} as const satisfies Record<string, Theme>;

const INITIAL_SNAPSHOT: ReaderSnapshot = {
  metaText: "No book loaded",
  pagination: {
    currentPage: 1,
    totalPages: 1
  },
  toc: []
};

export function App(): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const readerRef = useRef<EpubReader | null>(null);

  const [snapshot, setSnapshot] = useState<ReaderSnapshot>(INITIAL_SNAPSHOT);
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [themeKey, setThemeKey] = useState<keyof typeof THEMES>("paper");
  const [mode, setMode] = useState<"scroll" | "paginated">("scroll");
  const [fontSize, setFontSize] = useState(18);
  const [pageValue, setPageValue] = useState("1");
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const [selectedFileName, setSelectedFileName] = useState("No file selected");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [expandedTocIds, setExpandedTocIds] = useState<Set<string>>(new Set());
  const [activeTocId, setActiveTocId] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const reader = new EpubReader({
      container
    });
    readerRef.current = reader;

    const syncSnapshot = (): void => {
      const book = reader.getBook();
      const locator = reader.getCurrentLocation();

      if (!book || !locator) {
        setSnapshot({
          metaText: "No book loaded",
          pagination: reader.getPaginationInfo(),
          toc: book?.toc ?? []
        });
        setPageValue("1");
        return;
      }

      const section = book.sections[locator.spineIndex];
      const pagination = reader.getPaginationInfo();
      const nextActiveTocId = findActiveTocId(book.toc, section?.href ?? "");
      setSnapshot({
        metaText: `${book.metadata.title} · ${section?.title ?? section?.href ?? "Section"} · ${
          locator.spineIndex + 1
        } / ${book.sections.length} · Page ${pagination.currentPage} / ${pagination.totalPages}`,
        pagination,
        toc: book.toc
      });
      setActiveTocId(nextActiveTocId);
      if (nextActiveTocId) {
        setExpandedTocIds((current) => expandAncestors(current, book.toc, nextActiveTocId));
      }
      setPageValue(String(pagination.currentPage));
    };

    const offOpened = reader.on("opened", ({ book }) => {
      setResults([]);
      setExpandedTocIds(new Set(flattenBranchIds(book.toc)));
      setSnapshot((current) => ({
        ...current,
        toc: book.toc
      }));
      syncSnapshot();
    });
    const offRelocated = reader.on("relocated", syncSnapshot);
    const offRendered = reader.on("rendered", syncSnapshot);
    const offTypography = reader.on("typographyChanged", syncSnapshot);
    const offSearch = reader.on("searchCompleted", ({ results: nextResults }) => {
      setResults(nextResults);
    });

    const handleReaderClick = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const image = target.closest<HTMLImageElement>(".epub-image");
      if (!image) {
        return;
      }

      const src = image.dataset.fullsizeSrc || image.getAttribute("src");
      if (!src) {
        return;
      }

      setLightbox({
        src,
        alt: image.getAttribute("alt") ?? ""
      });
    };

    container.addEventListener("click", handleReaderClick);
    syncSnapshot();

    return () => {
      container.removeEventListener("click", handleReaderClick);
      offSearch();
      offTypography();
      offRendered();
      offRelocated();
      offOpened();
      reader.destroy();
      readerRef.current = null;
    };
  }, []);

  async function openFile(file: File): Promise<void> {
    const reader = readerRef.current;
    if (!reader) {
      return;
    }

    setSnapshot((current) => ({
      ...current,
      metaText: "Opening EPUB..."
    }));
    await reader.open(file);
    await reader.setTheme(THEMES[themeKey]);
    await reader.setTypography({ fontSize });
    await reader.setMode(mode);
    await reader.render();
  }

  async function goToPage(page: number): Promise<void> {
    const reader = readerRef.current;
    if (!reader || !Number.isFinite(page)) {
      return;
    }

    await reader.goToPage(page);
  }

  async function performSearch(): Promise<void> {
    const reader = readerRef.current;
    if (!reader) {
      return;
    }

    const normalized = searchQuery.trim();
    if (!normalized) {
      setResults([]);
      return;
    }

    const nextResults = await reader.search(normalized);
    if (nextResults.length === 0) {
      setResults([]);
    }
  }

  async function handleThemeChange(nextThemeKey: keyof typeof THEMES): Promise<void> {
    setThemeKey(nextThemeKey);
    await readerRef.current?.setTheme(THEMES[nextThemeKey]);
  }

  async function handleModeChange(nextMode: "scroll" | "paginated"): Promise<void> {
    setMode(nextMode);
    await readerRef.current?.setMode(nextMode);
  }

  async function handleFontSizeChange(nextSize: number): Promise<void> {
    setFontSize(nextSize);
    await readerRef.current?.setTypography({ fontSize: nextSize });
  }

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
          <div className="hero-search-results">
            <div className="hero-search-results-header">Search Results</div>
            <div className="hero-search-results-body">
              {results.length === 0 ? (
                <p className="empty-state">
                  {searchQuery.trim()
                    ? `No matches for "${searchQuery.trim()}".`
                    : "Run a search to see results."}
                </p>
              ) : (
                results.map((result, index) => (
                  <button
                    key={`${result.sectionId}-${index}`}
                    type="button"
                    className="search-card"
                    onClick={async () => {
                      await readerRef.current?.goToLocation(result.locator);
                    }}
                  >
                    <span className="block text-sm font-semibold">{result.href}</span>
                    <span className="mt-1 block text-sm text-slate-600">{result.excerpt}</span>
                  </button>
                ))
              )}
            </div>
          </div>
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
                    setSelectedFileName(file?.name ?? "No file selected");
                    if (file) {
                      await openFile(file);
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
                        await performSearch();
                      }
                    }}
                    placeholder="Search current book"
                    className="field-input search-input"
                  />
                  <button
                    type="button"
                    className="search-submit"
                    onClick={() => {
                      void performSearch();
                    }}
                  >
                    Search
                  </button>
                  <button
                    type="button"
                    className="search-clear"
                    onClick={() => {
                      setSearchQuery("");
                      setResults([]);
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
                      await handleThemeChange(value as keyof typeof THEMES);
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
                      await handleModeChange(value as "scroll" | "paginated");
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
        <aside className={`sidebar${sidebarCollapsed ? " is-collapsed" : ""}`}>
          {sidebarCollapsed ? (
            <button
              type="button"
              className="sidebar-toggle sidebar-toggle-floating"
              onClick={() => setSidebarCollapsed(false)}
              aria-label="Expand sidebar"
            >
              ›
            </button>
          ) : (
            <div className="sidebar-panel">
              <div className="sidebar-panel-header">
                <h2>Contents</h2>
                <button
                  type="button"
                  className="sidebar-toggle"
                  onClick={() => setSidebarCollapsed(true)}
                  aria-label="Collapse sidebar"
                >
                  ‹
                </button>
              </div>
              <div className="sidebar-panel-body">
                <div className="space-y-2">
                  {snapshot.toc.length === 0 ? (
                    <p className="empty-state">No table of contents available.</p>
                  ) : (
                    <TocTree
                      items={snapshot.toc}
                      activeId={activeTocId}
                      expandedIds={expandedTocIds}
                      onToggle={(id) => {
                        setExpandedTocIds((current) => toggleId(current, id));
                      }}
                      onSelect={async (id) => {
                        setActiveTocId(id);
                        setExpandedTocIds((current) => expandAncestors(current, snapshot.toc, id));
                        await readerRef.current?.goToTocItem(id);
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </aside>

          <section className="reader-panel">
            <div className="reader-toolbar">
              <ToolbarButton onClick={async () => readerRef.current?.prev()}>Previous</ToolbarButton>
              <ToolbarButton onClick={async () => readerRef.current?.next()}>Next</ToolbarButton>
              <label className="page-jump">
                <span>Page</span>
                <input
                  type="number"
                  min="1"
                  max={snapshot.pagination.totalPages}
                  value={pageValue}
                  onChange={(event) => setPageValue(event.target.value)}
                  onKeyDown={async (event) => {
                    if (event.key === "Enter") {
                      await goToPage(Number(pageValue));
                    }
                  }}
                  className="field-input page-input"
                />
              </label>
              <ToolbarButton onClick={async () => goToPage(Number(pageValue))}>Go</ToolbarButton>
            </div>

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
          </section>
        </section>

      {lightbox ? (
        <div
          className="image-lightbox"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setLightbox(null);
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
  );
}

function ToolbarButton(props: {
  children: string;
  onClick: () => void | Promise<void>;
}): JSX.Element {
  return (
    <button
      type="button"
      className="toolbar-button"
      onClick={() => {
        void props.onClick();
      }}
    >
      {props.children}
    </button>
  );
}

function TocTree(props: {
  items: TocItem[];
  activeId: string | null;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => Promise<void>;
}): JSX.Element {
  return (
    <ul className="toc-tree">
      {props.items.map((item) => (
        <li key={item.id} className="toc-item">
          <div className="toc-row">
            {item.children.length > 0 ? (
              <button
                type="button"
                className={`toc-disclosure${
                  props.expandedIds.has(item.id) ? " is-open" : ""
                }`}
                aria-label={props.expandedIds.has(item.id) ? "Collapse section" : "Expand section"}
                onClick={() => props.onToggle(item.id)}
              >
                ▸
              </button>
            ) : (
              <span className="toc-bullet" aria-hidden="true">
                •
              </span>
            )}
            <button
              type="button"
              className={`toc-link${props.activeId === item.id ? " is-active" : ""}`}
              onClick={() => {
                void props.onSelect(item.id);
              }}
            >
              {item.label}
            </button>
          </div>
          {item.children.length > 0 && props.expandedIds.has(item.id) ? (
            <div className="toc-children">
              <TocTree
                items={item.children}
                activeId={props.activeId}
                expandedIds={props.expandedIds}
                onToggle={props.onToggle}
                onSelect={props.onSelect}
              />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function CustomSelect(props: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void | Promise<void>;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const selected = props.options.find((option) => option.value === props.value) ?? props.options[0];

  useEffect(() => {
    function handlePointerDown(event: MouseEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  return (
    <div ref={rootRef} className={`custom-select${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="custom-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected?.label ?? ""}</span>
        <span className="custom-select-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div id={listboxId} role="listbox" className="custom-select-menu">
          {props.options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === props.value}
              className={`custom-select-option${
                option.value === props.value ? " is-selected" : ""
              }`}
              onClick={() => {
                setOpen(false);
                void props.onChange(option.value);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function flattenBranchIds(items: TocItem[]): string[] {
  return items.flatMap((item) => [
    ...(item.children.length > 0 ? [item.id] : []),
    ...flattenBranchIds(item.children)
  ]);
}

function findActiveTocId(items: TocItem[], href: string): string | null {
  for (const item of items) {
    const nested = findActiveTocId(item.children, href);
    if (nested) {
      return nested;
    }

    if (href && href.startsWith(item.href)) {
      return item.id;
    }
  }

  return null;
}

function findAncestorIds(items: TocItem[], targetId: string, trail: string[] = []): string[] | null {
  for (const item of items) {
    if (item.id === targetId) {
      return trail;
    }

    const nested = findAncestorIds(item.children, targetId, [...trail, item.id]);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function expandAncestors(current: Set<string>, items: TocItem[], targetId: string): Set<string> {
  const next = new Set(current);
  const ancestors = findAncestorIds(items, targetId) ?? [];
  for (const id of ancestors) {
    next.add(id);
  }
  return next;
}

function toggleId(current: Set<string>, id: string): Set<string> {
  const next = new Set(current);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}
