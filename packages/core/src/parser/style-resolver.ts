import type { BlockStyle, TextAlign, TextStyle } from "../model/types"
import type { CssAstDeclaration, CssAstStyleSheet } from "./css-ast-adapter"
import { getCssDeclarationValueText, getCssRuleDeclarations } from "./css-ast-adapter"
import type { HtmlDomElement } from "./html-dom-adapter"
import { getHtmlElementAttribute } from "./html-dom-adapter"
import { collectMatchedCssRules } from "./style-rule-matcher"

type ResolvedStyle = Partial<BlockStyle>

const ALLOWED_PROPERTIES = new Set([
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "color",
  "background-color",
  "text-align",
  "letter-spacing",
  "white-space",
  "word-break",
  "margin-top",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "padding-top",
  "padding-bottom",
  "padding-left",
  "padding-right"
])

export function resolveElementStyle(input: {
  element: HtmlDomElement
  stylesheets?: CssAstStyleSheet[]
  defaultStyle?: Partial<BlockStyle>
}): ResolvedStyle {
  const resolved: ResolvedStyle = { ...(input.defaultStyle ?? {}) }
  const stylesheets = input.stylesheets ?? []

  for (const matchedRule of collectMatchedCssRules(input.element, stylesheets)) {
    applyDeclarations(resolved, getCssRuleDeclarations(matchedRule.rule))
  }

  const inlineStyle = getHtmlElementAttribute(input.element, "style")
  if (inlineStyle?.trim()) {
    applyDeclarationEntries(resolved, parseInlineStyleAttribute(inlineStyle))
  }

  return resolved
}

export function resolveElementTextStyle(input: {
  element: HtmlDomElement
  stylesheets?: CssAstStyleSheet[]
  defaultStyle?: Partial<TextStyle>
}): Partial<TextStyle> {
  return resolveElementStyle({
    element: input.element,
    ...(input.stylesheets ? { stylesheets: input.stylesheets } : {}),
    ...(input.defaultStyle ? { defaultStyle: input.defaultStyle } : {})
  })
}

export function parseInlineStyleAttribute(
  source: string
): Array<{ property: string; value: string }> {
  return source
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const separatorIndex = entry.indexOf(":")
      if (separatorIndex < 0) {
        return []
      }

      const property = entry.slice(0, separatorIndex).trim().toLowerCase()
      const value = entry.slice(separatorIndex + 1).trim()
      if (!property || !value) {
        return []
      }

      return [{ property, value }]
    })
}

function applyDeclarations(
  target: ResolvedStyle,
  declarations: CssAstDeclaration[]
): void {
  applyDeclarationEntries(
    target,
    declarations.map((declaration) => ({
      property: declaration.property.toLowerCase(),
      value: getCssDeclarationValueText(declaration).trim()
    }))
  )
}

function applyDeclarationEntries(
  target: ResolvedStyle,
  declarations: Array<{ property: string; value: string }>
): void {
  for (const declaration of declarations) {
    if (!ALLOWED_PROPERTIES.has(declaration.property)) {
      continue
    }

    applySingleDeclaration(target, declaration.property, declaration.value)
  }
}

function applySingleDeclaration(
  target: ResolvedStyle,
  property: string,
  value: string
): void {
  switch (property) {
    case "font-size": {
      const fontSize = parseNumericValue(value)
      if (fontSize !== undefined) {
        target.fontSize = fontSize
      }
      break
    }
    case "font-weight":
      target.fontWeight = value
      break
    case "font-style":
      if (value === "normal" || value === "italic") {
        target.fontStyle = value
      }
      break
    case "line-height": {
      const lineHeight = parseNumericValue(value)
      if (lineHeight !== undefined) {
        target.lineHeight = lineHeight
      }
      break
    }
    case "color":
      target.color = value
      break
    case "background-color":
      target.backgroundColor = value
      break
    case "text-align": {
      const textAlign = normalizeTextAlign(value)
      if (textAlign) {
        target.textAlign = textAlign
      }
      break
    }
    case "letter-spacing": {
      const letterSpacing = parseNumericValue(value)
      if (letterSpacing !== undefined) {
        target.letterSpacing = letterSpacing
      }
      break
    }
    case "white-space":
      if (value === "normal" || value === "pre-wrap") {
        target.whiteSpace = value
      }
      break
    case "word-break":
      if (value === "normal" || value === "keep-all" || value === "break-word") {
        target.wordBreak = value
      }
      break
    case "margin-top":
      assignBlockMetric(target, "marginTop", value)
      break
    case "margin-bottom":
      assignBlockMetric(target, "marginBottom", value)
      break
    case "margin-left":
      assignBlockMetric(target, "marginLeft", value)
      break
    case "margin-right":
      assignBlockMetric(target, "marginRight", value)
      break
    case "padding-top":
      assignBlockMetric(target, "paddingTop", value)
      break
    case "padding-bottom":
      assignBlockMetric(target, "paddingBottom", value)
      break
    case "padding-left":
      assignBlockMetric(target, "paddingLeft", value)
      break
    case "padding-right":
      assignBlockMetric(target, "paddingRight", value)
      break
    default:
      break
  }
}

function assignBlockMetric(
  target: ResolvedStyle,
  property:
    | "marginTop"
    | "marginBottom"
    | "marginLeft"
    | "marginRight"
    | "paddingTop"
    | "paddingBottom"
    | "paddingLeft"
    | "paddingRight",
  value: string
): void {
  const numericValue = parseNumericValue(value)
  if (numericValue !== undefined) {
    target[property] = numericValue
  }
}

function normalizeTextAlign(value: string): TextAlign | undefined {
  switch (value) {
    case "left":
    case "start":
      return "start"
    case "right":
    case "end":
      return "end"
    case "center":
      return "center"
    case "justify":
      return "justify"
    default:
      return undefined
  }
}

function parseNumericValue(value: string): number | undefined {
  const normalized = value.trim().toLowerCase()
  if (!normalized) {
    return undefined
  }

  const matched = normalized.match(/^(-?\d+(?:\.\d+)?)(px)?$/)
  if (!matched) {
    return undefined
  }

  const parsed = Number(matched[1])
  return Number.isNaN(parsed) ? undefined : parsed
}
