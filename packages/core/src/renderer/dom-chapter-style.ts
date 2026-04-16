import type { Theme, TypographyOptions } from "../model/types";
import {
  buildReadingStyleCssVariables,
  buildReadingStyleProfile
} from "./reading-style-profile";

export function buildDomChapterNormalizationCss(input: {
  theme: Theme;
  typography: TypographyOptions;
  fontFamily: string;
  presentationRole?: "cover" | "image-page";
}): string {
  const profile = buildReadingStyleProfile({
    theme: input.theme,
    typography: input.typography
  });
  const variables = buildReadingStyleCssVariables(profile);

  return [
    `.epub-dom-section {`,
    `  color: ${input.theme.color};`,
    `  background: transparent;`,
    `  font-family: ${input.fontFamily};`,
    `  font-size: ${input.typography.fontSize}px;`,
    `  line-height: ${input.typography.lineHeight};`,
    ...Object.entries(variables).map(([name, value]) => `  ${name}: ${value};`),
    `  padding: 0 var(--reader-side-padding) var(--reader-bottom-padding);`,
    `  box-sizing: border-box;`,
    `}`,
    `.epub-dom-cover, .epub-dom-image-page {`,
    `  padding: 0;`,
    `}`,
    `.epub-dom-section :where(p, blockquote, pre, ul, ol, dl, table, figure, aside, nav) {`,
    `  margin-top: 0;`,
    `  margin-bottom: var(--reader-paragraph-spacing);`,
    `}`,
    `.epub-dom-section :where(h1, h2, h3, h4, h5, h6) {`,
    `  margin-top: 0;`,
    `  margin-bottom: var(--reader-heading-spacing);`,
    `  line-height: 1.25;`,
    `}`,
    `.epub-dom-section a {`,
    `  color: var(--reader-link-color);`,
    `}`,
    `.epub-dom-section blockquote {`,
    `  margin-left: 0;`,
    `  margin-right: 0;`,
    `  padding-left: var(--reader-quote-accent-gap);`,
    `  border-left: var(--reader-quote-accent-width) solid var(--reader-quote-accent-color);`,
    `}`,
    `.epub-dom-section ul, .epub-dom-section ol {`,
    `  padding-left: calc(var(--reader-side-padding) + 28px);`,
    `}`,
    `.epub-dom-section img {`,
    `  max-width: 100%;`,
    `  height: auto;`,
    `}`,
    `.epub-dom-section-cover img {`,
      `  display: block;`,
      `  width: 100%;`,
      `  max-width: none;`,
    `}`,
    `.epub-dom-section-image-page img {`,
    `  display: block;`,
    `  max-width: 100%;`,
    `  width: auto;`,
    `  margin: 0 auto;`,
    `}`,
    `.epub-dom-section table {`,
    `  width: 100%;`,
    `  border-collapse: collapse;`,
    `}`,
    `.epub-dom-section th, .epub-dom-section td {`,
    `  border: 1px solid var(--reader-table-border-color);`,
    `  padding: var(--reader-table-cell-padding);`,
    `  vertical-align: top;`,
    `  text-align: left;`,
    `}`,
    `.epub-dom-section pre, .epub-dom-section code {`,
    `  font-family: ${profile.code.fontFamily};`,
    `}`,
    `.epub-dom-section pre {`,
    `  white-space: pre-wrap;`,
    `  background: var(--reader-code-bg);`,
    `  color: var(--reader-code-color);`,
    `  padding: ${profile.code.blockPaddingY}px ${profile.code.blockPaddingX}px;`,
    `  border-radius: ${profile.code.blockRadius}px;`,
    `}`,
    `.epub-dom-section code {`,
    `  color: var(--reader-inline-code-color);`,
    `}`,
    `.epub-dom-section :not(pre) > code, .epub-dom-section .code-fragment {`,
    `  background: var(--reader-inline-code-bg);`,
    `  padding: ${profile.code.inlinePaddingY}px ${profile.code.inlinePaddingX}px;`,
    `  border-radius: ${profile.code.inlineRadius}px;`,
    `}`,
    `.epub-dom-section pre code {`,
    `  background: transparent;`,
    `  padding: 0;`,
    `}`
  ].join("\n");
}
