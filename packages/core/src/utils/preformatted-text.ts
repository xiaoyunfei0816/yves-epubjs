function extractFontSize(font: string): number {
  const match = font.match(/(\d+(?:\.\d+)?)px/)
  return match ? Number.parseFloat(match[1]!) : 16
}

function approximateTextWidth(text: string, fontSize: number): number {
  const wideChars = Array.from(text).filter((char) => char.charCodeAt(0) > 255).length
  const asciiChars = Math.max(0, text.length - wideChars)
  return wideChars * fontSize * 0.92 + asciiChars * fontSize * 0.56
}

function expandTabs(text: string, tabWidth: number): string {
  return text.replace(/\t/g, " ".repeat(Math.max(1, tabWidth)))
}

export function normalizePreformattedText(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")

  if (lines[0]?.trim() === "") {
    lines.shift()
  }
  if (lines.at(-1)?.trim() === "") {
    lines.pop()
  }

  return lines.join("\n")
}

export function wrapPreformattedText(
  text: string,
  maxWidth: number,
  font: string,
  tabWidth = 2
): string[] {
  const safeWidth = Math.max(1, maxWidth)
  const fontSize = extractFontSize(font)
  const normalized = text.replace(/\r\n?/g, "\n")

  if (!normalized) {
    return [""]
  }

  const lines: string[] = []
  for (const rawLine of normalized.split("\n")) {
    const expandedLine = expandTabs(rawLine, tabWidth)
    if (!expandedLine) {
      lines.push("")
      continue
    }

    let current = ""
    for (const char of Array.from(expandedLine)) {
      const candidate = current + char
      if (current.length === 0 || approximateTextWidth(candidate, fontSize) <= safeWidth) {
        current = candidate
        continue
      }

      lines.push(current)
      current = char
    }

    lines.push(current)
  }

  return lines
}

export function countWrappedPreformattedLines(
  text: string,
  maxWidth: number,
  font: string,
  tabWidth = 2
): number {
  return wrapPreformattedText(text, maxWidth, font, tabWidth).length
}
