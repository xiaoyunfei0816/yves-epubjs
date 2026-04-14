import { EpubReader, type SearchResult, type TocItem } from "../../core/src/index";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app container");
}

app.innerHTML = `
  <main class="shell">
    <header class="hero">
      <div>
        <p class="eyebrow">Pretext EPUB Reader</p>
        <h1>Open an EPUB and read it in the browser.</h1>
        <p class="hero-copy">
          This demo runs the parser/runtime pipeline with pretext-backed text layout: ZIP -> container.xml -> OPF -> NAV/NCX -> XHTML sections -> pretext line layout -> reader UI.
        </p>
      </div>
      <div class="hero-panel">
        <label class="file-picker">
          <span>Select EPUB</span>
          <input id="file-input" type="file" accept=".epub,application/epub+zip" />
        </label>
        <div class="controls-grid">
          <label>
            <span>Search</span>
            <input id="search-input" type="search" placeholder="Search current book" />
          </label>
          <label>
            <span>Theme</span>
            <select id="theme-select">
              <option value="paper">Paper</option>
              <option value="night">Night</option>
              <option value="sage">Sage</option>
            </select>
          </label>
          <label>
            <span>Font Size</span>
            <input id="font-size-input" type="range" min="14" max="28" value="18" />
          </label>
          <label>
            <span>Mode</span>
            <select id="mode-select">
              <option value="scroll">Scroll</option>
              <option value="paginated">Paginated</option>
            </select>
          </label>
        </div>
      </div>
    </header>
    <section class="workspace">
      <aside class="sidebar">
        <div class="sidebar-panel">
          <h2>Contents</h2>
          <nav id="toc-root" class="toc-root"></nav>
        </div>
        <div class="sidebar-panel">
          <h2>Search Results</h2>
          <div id="search-results" class="search-results"></div>
        </div>
      </aside>
      <section class="reader-panel">
        <div class="reader-toolbar">
          <button id="prev-btn" type="button">Previous</button>
          <button id="next-btn" type="button">Next</button>
          <label class="page-jump">
            <span>Page</span>
            <input id="page-input" type="number" min="1" value="1" />
          </label>
          <button id="go-page-btn" type="button">Go</button>
          <button id="search-btn" type="button">Search</button>
          <button id="clear-search-btn" type="button">Clear Search</button>
        </div>
        <div id="reader-meta" class="reader-meta">No book loaded</div>
        <div class="reader-progress">
          <input id="page-range" class="page-range" type="range" min="1" max="1" value="1" />
          <div id="page-status" class="page-status">Page 1 / 1</div>
        </div>
        <div id="reader-root" class="reader-root">
          <article class="placeholder-page">
            <h2>Waiting for an EPUB</h2>
            <p>Select a local EPUB file to parse and render it.</p>
          </article>
        </div>
      </section>
    </section>
    <div id="image-lightbox" class="image-lightbox" hidden>
      <button id="lightbox-close" class="image-lightbox-close" type="button" aria-label="Close image preview">Close</button>
      <img id="lightbox-image" class="image-lightbox-image" alt="" />
    </div>
  </main>
`;

const readerRoot = document.querySelector<HTMLElement>("#reader-root");
const readerMeta = document.querySelector<HTMLElement>("#reader-meta");
const tocRoot = document.querySelector<HTMLElement>("#toc-root");
const searchResultsRoot = document.querySelector<HTMLElement>("#search-results");
const fileInput = document.querySelector<HTMLInputElement>("#file-input");
const searchInput = document.querySelector<HTMLInputElement>("#search-input");
const themeSelect = document.querySelector<HTMLSelectElement>("#theme-select");
const modeSelect = document.querySelector<HTMLSelectElement>("#mode-select");
const fontSizeInput = document.querySelector<HTMLInputElement>("#font-size-input");
const prevButton = document.querySelector<HTMLButtonElement>("#prev-btn");
const nextButton = document.querySelector<HTMLButtonElement>("#next-btn");
const pageInput = document.querySelector<HTMLInputElement>("#page-input");
const goPageButton = document.querySelector<HTMLButtonElement>("#go-page-btn");
const pageRange = document.querySelector<HTMLInputElement>("#page-range");
const pageStatus = document.querySelector<HTMLElement>("#page-status");
const searchButton = document.querySelector<HTMLButtonElement>("#search-btn");
const clearSearchButton = document.querySelector<HTMLButtonElement>("#clear-search-btn");
const imageLightbox = document.querySelector<HTMLElement>("#image-lightbox");
const lightboxImage = document.querySelector<HTMLImageElement>("#lightbox-image");
const lightboxClose = document.querySelector<HTMLButtonElement>("#lightbox-close");

if (
  !readerRoot ||
  !readerMeta ||
  !tocRoot ||
  !searchResultsRoot ||
  !fileInput ||
  !searchInput ||
  !themeSelect ||
  !modeSelect ||
  !fontSizeInput ||
  !prevButton ||
  !nextButton ||
  !pageInput ||
  !goPageButton ||
  !pageRange ||
  !pageStatus ||
  !searchButton ||
  !clearSearchButton ||
  !imageLightbox ||
  !lightboxImage ||
  !lightboxClose
) {
  throw new Error("Missing demo controls");
}

const ui = {
  readerRoot,
  readerMeta,
  tocRoot,
  searchResultsRoot,
  fileInput,
  searchInput,
  themeSelect,
  modeSelect,
  fontSizeInput,
  prevButton,
  nextButton,
  pageInput,
  goPageButton,
  pageRange,
  pageStatus,
  searchButton,
  clearSearchButton,
  imageLightbox,
  lightboxImage,
  lightboxClose
};

const themes = {
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
} as const;

const reader = new EpubReader({
  container: ui.readerRoot
});

function renderToc(items: TocItem[]): string {
  if (items.length === 0) {
    return `<p class="empty-state">No table of contents available.</p>`;
  }

  return `<ul class="toc-list">${items
    .map(
      (item) => `
        <li>
          <button class="toc-link" type="button" data-toc-id="${item.id}">${item.label}</button>
          ${item.children.length > 0 ? renderToc(item.children) : ""}
        </li>
      `
    )
    .join("")}</ul>`;
}

function renderSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return `<p class="empty-state">No results.</p>`;
  }

  return `<ul class="search-list">${results
    .map(
      (result, index) => `
        <li>
          <button class="search-link" type="button" data-result-index="${index}">
            <span class="search-hit-title">${result.href}</span>
            <span class="search-hit-excerpt">${result.excerpt}</span>
          </button>
        </li>
      `
    )
    .join("")}</ul>`;
}

function updateMeta(): void {
  const book = reader.getBook();
  const locator = reader.getCurrentLocation();

  if (!book || !locator) {
    ui.readerMeta.textContent = "No book loaded";
    return;
  }

  const section = book.sections[locator.spineIndex];
  const pagination = reader.getPaginationInfo();
  ui.readerMeta.textContent = `${book.metadata.title} · ${section?.title ?? section?.href ?? "Section"} · ${
    locator.spineIndex + 1
  } / ${book.sections.length} · Page ${pagination.currentPage} / ${pagination.totalPages}`;
}

function updatePaginationUi(): void {
  const pagination = reader.getPaginationInfo();
  ui.pageInput.max = String(pagination.totalPages);
  ui.pageInput.value = String(pagination.currentPage);
  ui.pageRange.max = String(pagination.totalPages);
  ui.pageRange.value = String(pagination.currentPage);
  ui.pageStatus.textContent = `Page ${pagination.currentPage} / ${pagination.totalPages}`;
}

let lastResults: SearchResult[] = [];

reader.on("opened", ({ book }) => {
  ui.tocRoot.innerHTML = renderToc(book.toc);
  ui.searchResultsRoot.innerHTML = `<p class="empty-state">Run a search to see results.</p>`;
  lastResults = [];
  updateMeta();
  updatePaginationUi();
});

reader.on("relocated", () => {
  updateMeta();
  updatePaginationUi();
});

reader.on("searchCompleted", ({ results }) => {
  lastResults = results;
  ui.searchResultsRoot.innerHTML = renderSearchResults(results);
});

async function performSearch(): Promise<void> {
  const query = ui.searchInput.value.trim();
  const results = await reader.search(query);
  if (!query) {
    ui.searchResultsRoot.innerHTML = `<p class="empty-state">Enter a query to search the loaded book.</p>`;
  } else if (results.length === 0) {
    ui.searchResultsRoot.innerHTML = `<p class="empty-state">No matches for "${query}".</p>`;
  }
}

ui.fileInput.addEventListener("change", async () => {
  const file = ui.fileInput.files?.[0];
  if (!file) {
    return;
  }

  ui.readerMeta.textContent = "Opening EPUB...";
  const book = await reader.open(file);
  await reader.render();
  ui.tocRoot.innerHTML = renderToc(book.toc);
  updateMeta();
  updatePaginationUi();
});

ui.themeSelect.addEventListener("change", async () => {
  await reader.setTheme(themes[ui.themeSelect.value as keyof typeof themes]);
});

ui.modeSelect.addEventListener("change", async () => {
  await reader.setMode(ui.modeSelect.value as "scroll" | "paginated");
});

ui.fontSizeInput.addEventListener("input", async () => {
  await reader.setTypography({ fontSize: Number(ui.fontSizeInput.value) });
});

ui.prevButton.addEventListener("click", async () => {
  await reader.prev();
});

ui.nextButton.addEventListener("click", async () => {
  await reader.next();
});

ui.goPageButton.addEventListener("click", async () => {
  const pageNumber = Number(ui.pageInput.value);
  if (!Number.isFinite(pageNumber)) {
    return;
  }

  await reader.goToPage(pageNumber);
});

ui.pageInput.addEventListener("keydown", async (event) => {
  if (event.key === "Enter") {
    const pageNumber = Number(ui.pageInput.value);
    if (!Number.isFinite(pageNumber)) {
      return;
    }

    await reader.goToPage(pageNumber);
  }
});

ui.pageRange.addEventListener("input", async () => {
  const pageNumber = Number(ui.pageRange.value);
  if (!Number.isFinite(pageNumber)) {
    return;
  }

  await reader.goToPage(pageNumber);
});

ui.searchButton.addEventListener("click", async () => {
  await performSearch();
});

ui.clearSearchButton.addEventListener("click", () => {
  ui.searchInput.value = "";
  lastResults = [];
  ui.searchResultsRoot.innerHTML = `<p class="empty-state">Run a search to see results.</p>`;
});

ui.searchInput.addEventListener("keydown", async (event) => {
  if (event.key === "Enter") {
    await performSearch();
  }
});

ui.tocRoot.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest<HTMLButtonElement>("[data-toc-id]");
  if (!button) {
    return;
  }

  await reader.goToTocItem(button.dataset.tocId ?? "");
});

ui.searchResultsRoot.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest<HTMLButtonElement>("[data-result-index]");
  if (!button) {
    return;
  }

  const index = Number(button.dataset.resultIndex);
  const result = lastResults[index];
  if (!result) {
    return;
  }

  await reader.goToLocation(result.locator);
});

ui.readerRoot.addEventListener("click", (event) => {
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

  ui.lightboxImage.src = src;
  ui.lightboxImage.alt = image.getAttribute("alt") ?? "";
  ui.imageLightbox.hidden = false;
});

function closeLightbox(): void {
  ui.imageLightbox.hidden = true;
  ui.lightboxImage.removeAttribute("src");
}

ui.lightboxClose.addEventListener("click", closeLightbox);

ui.imageLightbox.addEventListener("click", (event) => {
  if (event.target === ui.imageLightbox) {
    closeLightbox();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !ui.imageLightbox.hidden) {
    closeLightbox();
  }
});
