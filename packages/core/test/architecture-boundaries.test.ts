import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const CORE_SRC = path.resolve(process.cwd(), "packages/core/src")

const EXPECTED_ROOT_EXPORTS = [
  "./model/types",
  "./runtime/reader",
  "./runtime/bookmark",
  "./runtime/annotation",
  "./runtime/locator",
  "./runtime/preferences",
  "./runtime/publisher-styles",
  "./runtime/reading-language",
  "./runtime/reading-spread",
  "./runtime/accessibility",
  "./runtime/chapter-preprocess",
  "./runtime/chapter-analysis-input",
  "./runtime/chapter-render-decision",
  "./runtime/chapter-render-input",
  "./runtime/chapter-render-analyzer",
  "./runtime/chapter-render-decision-cache",
  "./container/resource-container",
  "./container/normalize-input",
  "./container/resource-path",
  "./container/resource-mime",
  "./parser/book-parser",
  "./parser/container-parser",
  "./parser/nav-parser",
  "./parser/ncx-parser",
  "./parser/opf-parser",
  "./parser/inline-parser",
  "./parser/html-dom-adapter",
  "./parser/css-ast-adapter",
  "./parser/css-resource-loader",
  "./parser/selector-matcher",
  "./parser/style-rule-matcher",
  "./parser/style-resolver",
  "./parser/spine-content-parser",
  "./parser/xhtml-dom-parser",
  "./parser/xhtml-parser",
  "./layout/layout-engine",
  "./renderer/draw-ops",
  "./renderer/display-list-builder",
  "./renderer/canvas-renderer",
  "./renderer/dom-chapter-renderer",
  "./renderer/dom-chapter-style",
  "./renderer/reading-style-profile"
]

describe("core architecture boundaries", () => {
  it("does not allow parser/layout imports from runtime", () => {
    const imports = collectRuntimeImports(["parser", "layout"])

    expect(imports).toEqual([])
  })

  it("keeps root package exports intentional", () => {
    expect(readRootExports()).toEqual(EXPECTED_ROOT_EXPORTS)
  })
})

function collectRuntimeImports(sourceDirs: string[]): string[] {
  const imports: string[] = []
  for (const sourceDir of sourceDirs) {
    for (const file of collectTypeScriptFiles(path.join(CORE_SRC, sourceDir))) {
      const source = readFileSync(file, "utf8")
      const relativeFile = path.relative(CORE_SRC, file)
      for (const specifier of readImportSpecifiers(source)) {
        if (specifier.startsWith("../runtime/")) {
          imports.push(`${relativeFile} -> ${specifier}`)
        }
      }
    }
  }
  return imports.sort()
}

function collectTypeScriptFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory)) {
    const fullPath = path.join(directory, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      files.push(...collectTypeScriptFiles(fullPath))
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      files.push(fullPath)
    }
  }
  return files
}

function readImportSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const pattern = /from\s+["']([^"']+)["']/g
  let match = pattern.exec(source)
  while (match) {
    if (match[1]) {
      specifiers.push(match[1])
    }
    match = pattern.exec(source)
  }
  return specifiers
}

function readRootExports(): string[] {
  const source = readFileSync(path.join(CORE_SRC, "index.ts"), "utf8")
  const exports: string[] = []
  const pattern = /export\s+\*\s+from\s+["']([^"']+)["']/g
  let match = pattern.exec(source)
  while (match) {
    if (match[1]) {
      exports.push(match[1])
    }
    match = pattern.exec(source)
  }
  return exports
}
