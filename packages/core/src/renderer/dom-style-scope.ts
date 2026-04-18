import { generate, parse } from "css-tree"
import type { CssAstNode } from "../parser/css-ast-adapter"

const DOM_STYLE_SCOPE_SELECTOR = ".epub-dom-section"
const KEYFRAME_SELECTOR_PATTERN = /^(?:from|to|\d+(?:\.\d+)?%)$/i
const GLOBAL_AT_RULES_TO_DROP = new Set([
  "charset",
  "font-face",
  "font-feature-values",
  "font-palette-values",
  "import",
  "namespace",
  "page",
  "property",
  "counter-style"
])
type MutableCssNode = CssAstNode & {
  name?: string
  prelude?: CssAstNode
  block?: {
    children?: {
      toArray?(): CssAstNode[]
    }
  }
  children?: {
    toArray?(): CssAstNode[]
    clear?(): void
    appendData?(value: CssAstNode): void
  }
}

export function scopeDomStyleSheetCss(
  value: string,
  scopeSelector = DOM_STYLE_SCOPE_SELECTOR
): string {
  if (!value.trim()) {
    return value
  }

  try {
    const stylesheet = parse(value, {
      context: "stylesheet",
      parseAtrulePrelude: true,
      parseRulePrelude: true,
      parseValue: true
    }) as MutableCssNode

    pruneGlobalAtRules(stylesheet)
    scopeCssNode(stylesheet, false, scopeSelector)
    return generate(stylesheet)
  } catch {
    return value
  }
}

function pruneGlobalAtRules(root: MutableCssNode): void {
  const children = root.children?.toArray?.() ?? []
  if (!root.children?.clear || !root.children?.appendData) {
    return
  }

  root.children.clear()
  for (const child of children) {
    const candidate = child as MutableCssNode
    if (candidate.type === "Atrule" && shouldDropGlobalAtRule(candidate.name)) {
      continue
    }
    root.children.appendData(candidate)
  }
}

function scopeCssNode(
  node: MutableCssNode | undefined,
  insideKeyframes: boolean,
  scopeSelector: string
): void {
  if (!node) {
    return
  }

  if (node.type === "Atrule") {
    const atruleName = typeof node.name === "string" ? node.name.toLowerCase() : ""
    const nextInsideKeyframes =
      insideKeyframes || atruleName === "keyframes" || atruleName.endsWith("keyframes")

    for (const child of getCssNodeListChildren(node.block)) {
      scopeCssNode(child, nextInsideKeyframes, scopeSelector)
    }
    return
  }

  if (node.type === "Rule") {
    if (!insideKeyframes && isSelectorListNode(node.prelude)) {
      const selectorText = getCssNodeListChildren(node.prelude)
        .map((selectorNode: unknown) =>
          scopeCssSelectorText(generate(selectorNode as Parameters<typeof generate>[0]), scopeSelector)
        )
        .join(", ")
      node.prelude = parse(selectorText, {
        context: "selectorList"
      }) as MutableCssNode
    }

    for (const child of getCssNodeListChildren(node.block)) {
      scopeCssNode(child, insideKeyframes, scopeSelector)
    }
    return
  }

  for (const child of getCssChildren(node)) {
    scopeCssNode(child, insideKeyframes, scopeSelector)
  }
}

function getCssChildren(node: MutableCssNode): MutableCssNode[] {
  const directChildren = getCssNodeListChildren(node)
  const blockChildren = getCssNodeListChildren(node.block)

  return [...directChildren, ...blockChildren]
}

function getCssNodeListChildren(
  node:
    | {
        children?: {
          toArray?(): CssAstNode[]
        }
      }
    | undefined
): MutableCssNode[] {
  return node?.children?.toArray?.() as MutableCssNode[] | undefined ?? []
}

function isSelectorListNode(node: CssAstNode | undefined): node is MutableCssNode & { type: "SelectorList" } {
  return Boolean(node && node.type === "SelectorList")
}

function scopeCssSelectorText(selectorText: string, scopeSelector: string): string {
  const normalized = selectorText.trim()
  if (!normalized || KEYFRAME_SELECTOR_PATTERN.test(normalized)) {
    return normalized
  }

  if (normalized.startsWith(scopeSelector)) {
    return normalized
  }

  const withoutRootSelector = normalized.replace(
    /^(?:(?:html|body|:root)\s*)+/i,
    ""
  )
  if (withoutRootSelector !== normalized) {
    const remainder = withoutRootSelector.trimStart()
    if (!remainder) {
      return scopeSelector
    }
    return `${scopeSelector} ${remainder}`.trim()
  }

  return `${scopeSelector} ${normalized}`
}

function shouldDropGlobalAtRule(name: unknown): boolean {
  return typeof name === "string" && GLOBAL_AT_RULES_TO_DROP.has(name.toLowerCase())
}
