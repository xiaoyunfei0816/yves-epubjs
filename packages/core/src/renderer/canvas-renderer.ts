import type { Point, Rect } from "../model/types";
import type {
  DrawOp,
  ImageDrawOp,
  InteractionRegion,
  RectDrawOp,
  SectionDisplayList,
  TextRunDrawOp
} from "./draw-ops";

type RenderCanvasSection = {
  sectionId: string;
  height: number;
  canvas: HTMLCanvasElement;
  interactions: InteractionRegion[];
};

export type CanvasRenderResult = {
  sections: RenderCanvasSection[];
  bounds: Rect[];
  drawOpCount: number;
  totalCanvasHeight: number;
};

export class CanvasRenderer {
  private readonly imageCache = new Map<string, HTMLImageElement>();
  private paintVersion = 0;

  renderPaginated(
    container: HTMLElement,
    displayList: SectionDisplayList,
    height: number,
    externalCanvas?: HTMLCanvasElement
  ): CanvasRenderResult {
    container.innerHTML = "";
    const canvas = externalCanvas ?? document.createElement("canvas");
    canvas.className = "epub-canvas epub-canvas-paginated";
    canvas.dataset.sectionId = displayList.sectionId;
    canvas.style.display = "block";
    canvas.style.margin = "0 auto";
    this.prepareCanvas(canvas, displayList.width, Math.max(height, displayList.height));
    const renderToken = this.assignRenderToken(canvas);
    if (!externalCanvas) {
      container.appendChild(canvas);
    }
    this.paint(canvas, displayList, renderToken);

    return {
      sections: [
        {
          sectionId: displayList.sectionId,
          height: Math.max(height, displayList.height),
          canvas,
          interactions: displayList.interactions
        }
      ],
      bounds: displayList.ops.map((op) => op.rect),
      drawOpCount: displayList.ops.length,
      totalCanvasHeight: Math.max(height, displayList.height)
    };
  }

  renderScrollable(
    container: HTMLElement,
    sectionsToRender: Array<{
      sectionId: string;
      sectionHref: string;
      height: number;
      displayList?: SectionDisplayList;
    }>,
    externalCanvas?: HTMLCanvasElement
  ): CanvasRenderResult {
    container.innerHTML = "";
    let totalCanvasHeight = 0;
    let drawOpCount = 0;
    const sections: RenderCanvasSection[] = [];
    const bounds: Rect[] = [];

    for (const sectionEntry of sectionsToRender) {
      if (!sectionEntry.displayList) {
        const wrapper = document.createElement("article");
        wrapper.className = "epub-section epub-section-virtual";
        wrapper.dataset.sectionId = sectionEntry.sectionId;
        wrapper.dataset.href = sectionEntry.sectionHref;
        wrapper.style.height = `${sectionEntry.height}px`;
        container.appendChild(wrapper);
        totalCanvasHeight += sectionEntry.height;
        continue;
      }

      const displayList = sectionEntry.displayList;
      const wrapper = document.createElement("article");
      wrapper.className = "epub-section epub-section-canvas";
      wrapper.dataset.sectionId = displayList.sectionId;
      wrapper.dataset.href = displayList.sectionHref;
      wrapper.style.height = `${displayList.height}px`;
      const canvas = externalCanvas && sectionsToRender.length === 1
        ? externalCanvas
        : document.createElement("canvas");
      canvas.className = "epub-canvas epub-canvas-section";
      canvas.style.display = "block";
      canvas.style.margin = "0 auto";
      this.prepareCanvas(canvas, displayList.width, displayList.height);
      const renderToken = this.assignRenderToken(canvas);
      this.paint(canvas, displayList, renderToken);
      if (!externalCanvas || sectionsToRender.length > 1) {
        wrapper.appendChild(canvas);
      }
      container.appendChild(wrapper);

      sections.push({
        sectionId: displayList.sectionId,
        height: displayList.height,
        canvas,
        interactions: displayList.interactions
      });
      totalCanvasHeight += displayList.height;
      drawOpCount += displayList.ops.length;
      bounds.push(...displayList.ops.map((op) => op.rect));
    }

    return {
      sections,
      bounds,
      drawOpCount,
      totalCanvasHeight
    };
  }

  hitTest(
    rendered: CanvasRenderResult,
    point: Point,
    scrollTop = 0
  ): InteractionRegion | null {
    let accumulatedTop = 0;
    const absoluteY = point.y + scrollTop;

    for (const section of rendered.sections) {
      const localY = absoluteY - accumulatedTop;
      if (localY >= 0 && localY <= section.height) {
        const hit =
          [...section.interactions]
            .reverse()
            .find((interaction) => containsPoint(interaction.rect, point.x, localY)) ?? null;
        if (hit) {
          return {
            ...hit,
            rect: {
              ...hit.rect,
              y: hit.rect.y + accumulatedTop
            }
          };
        }
      }
      accumulatedTop += section.height;
    }

    return null;
  }

  private prepareCanvas(
    canvas: HTMLCanvasElement,
    width: number,
    height: number
  ): void {
    const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * ratio));
    canvas.height = Math.max(1, Math.floor(height * ratio));
    canvas.style.width = `${Math.max(1, width)}px`;
    canvas.style.height = `${Math.max(1, height)}px`;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  private paint(
    canvas: HTMLCanvasElement,
    displayList: SectionDisplayList,
    renderToken: string
  ): void {
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.clearRect(0, 0, displayList.width, displayList.height);
    for (const op of displayList.ops) {
      switch (op.kind) {
        case "rect":
          this.paintRect(context, op);
          break;
        case "line":
          this.paintLine(context, op);
          break;
        case "image":
          this.paintImage(context, op, canvas, displayList, renderToken);
          break;
        case "text":
          this.paintText(context, op);
          break;
        default:
          break;
      }
    }
  }

  private paintRect(context: CanvasRenderingContext2D, op: RectDrawOp): void {
    context.save();
    context.fillStyle = op.color;
    if (op.radius && op.radius > 0) {
      roundRect(context, op.rect.x, op.rect.y, op.rect.width, op.rect.height, op.radius);
      context.fill();
    } else {
      context.fillRect(op.rect.x, op.rect.y, op.rect.width, op.rect.height);
    }
    if (op.strokeColor && op.strokeWidth) {
      context.strokeStyle = op.strokeColor;
      context.lineWidth = op.strokeWidth;
      context.strokeRect(op.rect.x, op.rect.y, op.rect.width, op.rect.height);
    }
    context.restore();
  }

  private paintLine(context: CanvasRenderingContext2D, op: DrawOp & { kind: "line" }): void {
    context.save();
    context.strokeStyle = op.color;
    context.lineWidth = op.lineWidth;
    context.beginPath();
    context.moveTo(op.x1, op.y1);
    context.lineTo(op.x2, op.y2);
    context.stroke();
    context.restore();
  }

  private paintText(context: CanvasRenderingContext2D, op: TextRunDrawOp): void {
    context.save();
    if (op.highlightColor) {
      context.fillStyle = op.highlightColor;
      context.fillRect(op.rect.x, op.rect.y, op.rect.width, op.rect.height);
    }
    context.font = op.font;
    context.textBaseline = "top";
    context.fillStyle = op.color;
    context.fillText(op.text, op.x, op.y);
    if (op.underline) {
      const underlineY = op.y + op.rect.height - 3;
      context.strokeStyle = op.color;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(op.x, underlineY);
      context.lineTo(op.x + op.width, underlineY);
      context.stroke();
    }
    context.restore();
  }

  private paintImage(
    context: CanvasRenderingContext2D,
    op: ImageDrawOp,
    canvas: HTMLCanvasElement,
    displayList: SectionDisplayList,
    renderToken: string
  ): void {
    context.save();
    context.fillStyle = op.background;
    roundRect(context, op.rect.x, op.rect.y, op.rect.width, op.rect.height, 14);
    context.fill();
    const image = this.loadImage(op.src, () => {
      if (canvas.dataset.renderToken !== renderToken) {
        return;
      }
      this.paint(canvas, displayList, renderToken);
    });
    if (image && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      const fittedRect = fitRectContain(
        {
          width: image.naturalWidth,
          height: image.naturalHeight
        },
        op.rect
      );
      context.drawImage(
        image,
        fittedRect.x,
        fittedRect.y,
        fittedRect.width,
        fittedRect.height
      );
    } else {
      context.fillStyle = "rgba(71, 85, 105, 0.72)";
      context.font = '600 14px "Iowan Old Style", "Palatino Linotype", serif';
      context.textBaseline = "middle";
      context.fillText("Image", op.rect.x + 16, op.rect.y + op.rect.height * 0.5);
    }
    context.restore();
  }

  private loadImage(src: string, onLoad?: () => void): HTMLImageElement | null {
    if (typeof Image === "undefined") {
      return null;
    }
    const cached = this.imageCache.get(src);
    if (cached) {
      if (
        onLoad &&
        (!cached.complete || cached.naturalWidth <= 0)
      ) {
        cached.addEventListener("load", onLoad, { once: true });
      }
      return cached;
    }
    const image = new Image();
    if (onLoad) {
      image.addEventListener("load", onLoad, { once: true });
    }
    image.src = src;
    this.imageCache.set(src, image);
    return image;
  }

  private assignRenderToken(canvas: HTMLCanvasElement): string {
    const token = `${++this.paintVersion}`;
    canvas.dataset.renderToken = token;
    return token;
  }
}

function containsPoint(rect: Rect, x: number, y: number): boolean {
  return (
    x >= rect.x &&
    x <= rect.x + rect.width &&
    y >= rect.y &&
    y <= rect.y + rect.height
  );
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const boundedRadius = Math.min(radius, width * 0.5, height * 0.5);
  context.beginPath();
  context.moveTo(x + boundedRadius, y);
  context.arcTo(x + width, y, x + width, y + height, boundedRadius);
  context.arcTo(x + width, y + height, x, y + height, boundedRadius);
  context.arcTo(x, y + height, x, y, boundedRadius);
  context.arcTo(x, y, x + width, y, boundedRadius);
  context.closePath();
}

function fitRectContain(
  source: {
    width: number;
    height: number;
  },
  target: Rect
): Rect {
  if (source.width <= 0 || source.height <= 0) {
    return target;
  }

  const scale = Math.min(
    target.width / source.width,
    target.height / source.height
  );
  const width = Math.max(1, source.width * scale);
  const height = Math.max(1, source.height * scale);

  return {
    x: target.x + (target.width - width) * 0.5,
    y: target.y + (target.height - height) * 0.5,
    width,
    height
  };
}
