import { generate, parse, type CssTreeDeclaration, type CssTreeNode, type CssTreeRule, type CssTreeStyleSheet } from "css-tree"

export type CssAstNode = CssTreeNode
export type CssAstStyleSheet = CssTreeStyleSheet
export type CssAstRule = CssTreeRule
export type CssAstDeclaration = CssTreeDeclaration

export function parseCssStyleSheet(source: string): CssAstStyleSheet {
  return parse(source, {
    context: "stylesheet",
    parseAtrulePrelude: true,
    parseRulePrelude: true,
    parseValue: true
  }) as CssAstStyleSheet
}

export function getCssTopLevelRules(stylesheet: CssAstStyleSheet): CssAstRule[] {
  return stylesheet.children
    .toArray()
    .filter((node): node is CssAstRule => node.type === "Rule")
}

export function getCssRuleDeclarations(rule: CssAstRule): CssAstDeclaration[] {
  const children = rule.block?.children?.toArray() ?? []
  return children.filter((node): node is CssAstDeclaration => node.type === "Declaration")
}

export function serializeCssNode(node: CssAstNode): string {
  return generate(node)
}

export function getCssDeclarationValueText(declaration: CssAstDeclaration): string {
  return declaration.value ? serializeCssNode(declaration.value) : ""
}
