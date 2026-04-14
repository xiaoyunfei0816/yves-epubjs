import type { LayoutBlock, LayoutResult } from "../layout/layout-engine";

function renderBlock(block: LayoutBlock): string {
  if (block.type === "pretext") {
    return `<div data-block-id="${block.id}" data-layout-kind="pretext">${block.lines
      .map(
        (line) =>
          `<div>${line.fragments.map((fragment) => fragment.text).join("")}</div>`
      )
      .join("")}</div>`;
  }

  return `<div data-block-id="${block.id}" data-layout-kind="native"></div>`;
}

export class DomRenderer {
  render(container: HTMLElement, layout: LayoutResult): void {
    container.innerHTML = layout.blocks.map(renderBlock).join("");
    container.dataset.mode = layout.mode;
  }
}
