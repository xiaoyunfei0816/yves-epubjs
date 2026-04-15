export function extractFontSize(font: string): number {
  const match = font.match(/(\d+(?:\.\d+)?)px/)
  return match ? Number.parseFloat(match[1]!) : 16
}

export function approximateTextWidth(text: string, font: string): number {
  const fontSize = extractFontSize(font)
  const wideChars = Array.from(text).filter((char) => char.charCodeAt(0) > 255).length
  const asciiChars = Math.max(0, text.length - wideChars)
  return wideChars * fontSize * 0.92 + asciiChars * fontSize * 0.56
}

export function wrapText(text: string, maxWidth: number, font: string): string[] {
  if (!text) {
    return [""]
  }

  const lines: string[] = []
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/(\s+)/).filter((part) => part.length > 0)
    let current = ""
    for (const word of words) {
      const candidate = current ? `${current}${word}` : word
      if (approximateTextWidth(candidate, font) <= maxWidth || !current) {
        current = candidate
        continue
      }
      lines.push(current.trimEnd())
      current = word.trimStart()
    }
    lines.push(current.trimEnd())
  }

  return lines.map((line) => line || "")
}

export function estimateWrappedTextHeight(
  text: string,
  width: number,
  font: string,
  lineHeight?: number
): number {
  const safeLineHeight = lineHeight ?? Math.max(extractFontSize(font) * 1.45, 18)
  return wrapText(text, width, font).length * safeLineHeight
}
