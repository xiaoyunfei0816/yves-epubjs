function estimateTextWidth(text: string, font: string): number {
  const fontSizeMatch = font.match(/(\d+(?:\.\d+)?)px/);
  const fontSize = fontSizeMatch ? Number.parseFloat(fontSizeMatch[1]) : 16;
  let width = 0;

  for (const char of Array.from(text)) {
    if (char === " ") {
      width += fontSize * 0.32;
      continue;
    }

    if (/[\u2e80-\u9fff\uf900-\ufaff]/u.test(char)) {
      width += fontSize;
      continue;
    }

    width += fontSize * 0.56;
  }

  return width;
}

if (typeof HTMLCanvasElement !== "undefined") {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value(contextId: string) {
      if (contextId !== "2d") {
        return null;
      }

      return {
        font: "16px serif",
        measureText(text: string) {
          return {
            width: estimateTextWidth(text, this.font)
          };
        }
      };
    }
  });
}

if (typeof document !== "undefined" && !("fonts" in document)) {
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      ready: Promise.resolve()
    }
  });
}
