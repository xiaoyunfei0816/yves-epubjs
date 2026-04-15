import type { Theme, TypographyOptions } from "../model/types";

export function buildDomChapterNormalizationCss(input: {
  theme: Theme;
  typography: TypographyOptions;
  fontFamily: string;
}): string {
  return [
    `.epub-dom-section {`,
    `  color: ${input.theme.color};`,
    `  background: transparent;`,
    `  font-family: ${input.fontFamily};`,
    `  font-size: ${input.typography.fontSize}px;`,
    `  line-height: ${input.typography.lineHeight};`,
    `  padding: 0 8px 24px;`,
    `  box-sizing: border-box;`,
    `}`,
    `.epub-dom-section :where(p, blockquote, pre, ul, ol, dl, table, figure, aside, nav) {`,
    `  margin-top: 0;`,
    `  margin-bottom: ${input.typography.paragraphSpacing}px;`,
    `}`,
    `.epub-dom-section :where(h1, h2, h3, h4, h5, h6) {`,
    `  margin-top: 0;`,
    `  margin-bottom: ${Math.max(12, Math.round(input.typography.paragraphSpacing * 0.9))}px;`,
    `  line-height: 1.25;`,
    `}`,
    `.epub-dom-section a {`,
    `  color: #1b4b72;`,
    `}`,
    `.epub-dom-section img {`,
    `  max-width: 100%;`,
    `  height: auto;`,
    `}`,
    `.epub-dom-section table {`,
    `  width: 100%;`,
    `  border-collapse: collapse;`,
    `}`,
    `.epub-dom-section th, .epub-dom-section td {`,
    `  border: 1px solid rgba(148, 163, 184, 0.7);`,
    `  padding: 8px;`,
    `  vertical-align: top;`,
    `}`,
    `.epub-dom-section pre, .epub-dom-section code {`,
    `  font-family: "SFMono-Regular", "SF Mono", Consolas, monospace;`,
    `}`,
    `.epub-dom-section pre {`,
    `  white-space: pre-wrap;`,
    `  background: rgba(15, 23, 42, 0.06);`,
    `  padding: 12px;`,
    `  border-radius: 12px;`,
    `}`,
    `.epub-dom-section code {`,
    `  background: rgba(15, 23, 42, 0.06);`,
    `  padding: 0.08em 0.3em;`,
    `  border-radius: 4px;`,
    `}`
  ].join("\n");
}
