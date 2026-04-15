declare module "css-tree" {
  export type CssTreeNode = {
    type: string
    [key: string]: unknown
  }

  export type CssTreeList<T = CssTreeNode> = {
    toArray(): T[]
  }

  export type CssTreeDeclaration = CssTreeNode & {
    type: "Declaration"
    property: string
    value?: CssTreeNode
  }

  export type CssTreeRule = CssTreeNode & {
    type: "Rule"
    prelude?: CssTreeNode
    block?: {
      children?: CssTreeList<CssTreeNode>
    }
  }

  export type CssTreeStyleSheet = CssTreeNode & {
    type: "StyleSheet"
    children: CssTreeList<CssTreeNode>
  }

  export function parse(
    source: string,
    options?: Record<string, unknown>
  ): CssTreeNode

  export function generate(node: CssTreeNode): string
}
