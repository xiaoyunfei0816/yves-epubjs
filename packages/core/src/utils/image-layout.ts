type ImageLayoutInput = {
  availableWidth: number;
  viewportHeight: number;
  intrinsicWidth?: number;
  intrinsicHeight?: number;
};

type ImageLayout = {
  width: number;
  height: number;
  xOffset: number;
  yOffset: number;
  blockHeight: number;
};

const IMAGE_VERTICAL_PADDING = 16;
const IMAGE_VERTICAL_OFFSET = IMAGE_VERTICAL_PADDING * 0.5;
const DEFAULT_IMAGE_HEIGHT_RATIO = 0.66;
const NORMAL_IMAGE_WIDTH_RATIO = 0.7;
const WIDE_IMAGE_WIDTH_RATIO = 0.95;
const PORTRAIT_IMAGE_WIDTH_RATIO = 0.9;
const MAX_IMAGE_HEIGHT_RATIO = 0.78;
const MAX_IMAGE_HEIGHT_PX = 900;
const MIN_IMAGE_WIDTH_WHEN_UNKNOWN = 120;

export function resolveImageLayout(input: ImageLayoutInput): ImageLayout {
  const availableWidth = Math.max(1, input.availableWidth);
  const viewportHeight = Math.max(220, input.viewportHeight);
  const intrinsicWidth =
    input.intrinsicWidth && input.intrinsicWidth > 0 ? input.intrinsicWidth : undefined;
  const intrinsicHeight =
    input.intrinsicHeight && input.intrinsicHeight > 0 ? input.intrinsicHeight : undefined;
  const aspectRatio =
    intrinsicWidth && intrinsicHeight ? intrinsicWidth / intrinsicHeight : undefined;
  const heightRatio =
    intrinsicWidth && intrinsicHeight
      ? intrinsicHeight / intrinsicWidth
      : DEFAULT_IMAGE_HEIGHT_RATIO;

  let widthRatio = NORMAL_IMAGE_WIDTH_RATIO;
  if (aspectRatio && aspectRatio >= 1.4) {
    widthRatio = WIDE_IMAGE_WIDTH_RATIO;
  } else if (aspectRatio && aspectRatio <= 0.85) {
    widthRatio = PORTRAIT_IMAGE_WIDTH_RATIO;
  }

  const widthCapByLayout = Math.min(availableWidth, availableWidth * widthRatio);
  const widthCapByIntrinsic = intrinsicWidth ?? Number.POSITIVE_INFINITY;
  const rawWidth = Math.min(widthCapByLayout, widthCapByIntrinsic);
  const width = intrinsicWidth
    ? Math.max(1, rawWidth)
    : Math.min(availableWidth, Math.max(MIN_IMAGE_WIDTH_WHEN_UNKNOWN, rawWidth));
  const uncappedHeight = width * heightRatio;
  const maxHeight = Math.min(MAX_IMAGE_HEIGHT_PX, viewportHeight * MAX_IMAGE_HEIGHT_RATIO);

  let renderedWidth = width;
  let renderedHeight = uncappedHeight;
  if (renderedHeight > maxHeight) {
    const scale = maxHeight / renderedHeight;
    renderedWidth *= scale;
    renderedHeight = maxHeight;
  }

  return {
    width: renderedWidth,
    height: renderedHeight,
    xOffset: Math.max(0, (availableWidth - renderedWidth) * 0.5),
    yOffset: IMAGE_VERTICAL_OFFSET,
    blockHeight: Math.max(renderedHeight + IMAGE_VERTICAL_PADDING, 48)
  };
}
