import type { Decoration } from "../model/types"
import { findRenderedAnchorTarget } from "./navigation-target"

const DECORATION_STYLE_TAG_SELECTOR = "style[data-epub-dom-decorations='true']"
const DECORATION_CLASSES = [
  "epub-dom-decoration-highlight",
  "epub-dom-decoration-underline",
  "epub-dom-decoration-search-hit",
  "epub-dom-decoration-active",
  "epub-dom-decoration-hint-margin-marker",
  "epub-dom-decoration-hint-note-icon"
] as const

export function applyDomDecorations(input: {
  container: HTMLElement
  sectionElement: HTMLElement
  decorations: Decoration[]
}): void {
  clearDomDecorations(input.container, input.sectionElement)
  if (input.decorations.length === 0) {
    return
  }

  ensureDomDecorationStyleTag(input.container)
  for (const decoration of input.decorations) {
    const target = resolveDomDecorationTarget(input.sectionElement, decoration)
    target.classList.add(toDomDecorationClass(decoration.style))
    const hintClass = toDomDecorationHintClass(decoration)
    if (hintClass) {
      target.classList.add(hintClass)
    }
    if (decoration.extras?.label) {
      target.dataset.epubDecorationLabel = decoration.extras.label
    }
  }
}

export function clearDomDecorations(container: HTMLElement, sectionElement?: HTMLElement): void {
  const scope = sectionElement ?? container
  for (const className of DECORATION_CLASSES) {
    scope
      .querySelectorAll<HTMLElement>(`.${className}`)
      .forEach((element) => element.classList.remove(className))
  }
  scope
    .querySelectorAll<HTMLElement>("[data-epub-decoration-label]")
    .forEach((element) => delete element.dataset.epubDecorationLabel)
}

function ensureDomDecorationStyleTag(container: HTMLElement): void {
  if (container.querySelector(DECORATION_STYLE_TAG_SELECTOR)) {
    return
  }

  const style = document.createElement("style")
  style.dataset.epubDomDecorations = "true"
  style.textContent = `
    .epub-dom-decoration-highlight {
      background: rgba(59, 130, 246, 0.14);
      border-radius: 0.2em;
    }
    .epub-dom-decoration-search-hit {
      background: rgba(245, 158, 11, 0.18);
      border-radius: 0.2em;
    }
    .epub-dom-decoration-underline {
      text-decoration: underline;
      text-decoration-thickness: 0.12em;
      text-decoration-color: rgba(37, 99, 235, 0.8);
      text-underline-offset: 0.16em;
    }
    .epub-dom-decoration-active {
      outline: 2px solid rgba(245, 158, 11, 0.45);
      outline-offset: 2px;
      background: rgba(245, 158, 11, 0.08);
      border-radius: 0.25em;
    }
    .epub-dom-decoration-hint-margin-marker {
      box-shadow: inset 4px 0 0 rgba(37, 99, 235, 0.42);
    }
    .epub-dom-decoration-hint-note-icon {
      outline: 1px dashed rgba(37, 99, 235, 0.35);
      outline-offset: 3px;
    }
  `
  container.prepend(style)
}

function resolveDomDecorationTarget(
  sectionElement: HTMLElement,
  decoration: Decoration
): HTMLElement {
  if (decoration.locator.anchorId) {
    const anchorTarget = findRenderedAnchorTarget(sectionElement, decoration.locator.anchorId)
    if (anchorTarget) {
      return anchorTarget
    }
  }

  if (decoration.locator.blockId) {
    const selectorValue = escapeAttributeSelectorValue(decoration.locator.blockId)
    const blockTarget = sectionElement.querySelector<HTMLElement>(`[id="${selectorValue}"]`)
    if (blockTarget) {
      return blockTarget
    }
  }

  return sectionElement
}

function toDomDecorationClass(style: Decoration["style"]): (typeof DECORATION_CLASSES)[number] {
  switch (style) {
    case "highlight":
      return "epub-dom-decoration-highlight"
    case "underline":
      return "epub-dom-decoration-underline"
    case "search-hit":
      return "epub-dom-decoration-search-hit"
    case "active":
      return "epub-dom-decoration-active"
  }
}

function toDomDecorationHintClass(
  decoration: Decoration
): "epub-dom-decoration-hint-margin-marker" | "epub-dom-decoration-hint-note-icon" | null {
  switch (decoration.extras?.renderHint) {
    case "margin-marker":
      return "epub-dom-decoration-hint-margin-marker"
    case "note-icon":
      return "epub-dom-decoration-hint-note-icon"
    default:
      return null
  }
}

function escapeAttributeSelectorValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')
}
