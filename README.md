# pretext-epub

一个基于 Pretext 的浏览器 EPUB 阅读器内核仓库，包含：

- 可复用的 TypeScript 核心包 `@pretext-epub/core`
- 用于手工验证和交互演示的 `Vite + React` demo
- 覆盖解析、渲染、导航、搜索、定位恢复的测试夹具与自动化测试

这个项目当前更偏向“阅读器内核 + 验证平台”，而不是一个已经产品化完成的书架应用。

## 项目定位

`pretext-epub` 试图解决的不是“把 EPUB 解开然后塞进 iframe”，而是把 EPUB 阅读器拆成可维护的几层：

- `container`：读取 `.epub` ZIP、资源路径和 MIME
- `parser`：解析 `container.xml`、OPF、NAV、NCX、XHTML
- `model`：统一内容模型和阅读领域类型
- `layout`：基于 Pretext 的文本布局
- `runtime`：阅读状态、定位、搜索、书签、批注、偏好
- `renderer`：`canvas / dom` 渲染与视口交互

仓库的一个核心策略是：简单章节优先走 `canvas`，复杂结构或复杂样式章节允许按章节回退到 `dom`，而不是无限扩张 `canvas` 对复杂出版社 CSS 的兼容面。

## 当前能力

截至当前仓库状态，已经可以稳定覆盖这些主路径：

- 打开本地 EPUB 二进制输入：`File`、`Blob`、`ArrayBuffer`、`Uint8Array`
- 解析 `OPF / NAV / NCX / XHTML`，输出统一 `Book` 模型
- 支持 `scroll` 和 `paginated` 两种阅读模式
- 支持章节级 `canvas / dom` 混合渲染与诊断信息输出
- 支持 TOC 导航、关键字搜索、搜索命中跳转
- 支持统一 `locator`、位置恢复、书签创建与恢复
- 支持高亮、批注、decoration overlay
- 支持主题、字号、字距、词距、publisher styles 等阅读偏好
- 提供 `lang / RTL` 基线能力和 accessibility snapshot
- 提供 demo、Vitest、Playwright、fixture 共同覆盖核心行为

当前仓库里也已经有针对 `pre-paginated`/固定版式场景、synthetic spread、真实 EPUB 回归验证的基础入口和 smoke coverage，但这些仍更接近“能力基线”而不是完整产品化功能。

## 仓库结构

```text
.
├─ packages/
│  ├─ core/              # EPUB 解析、布局、runtime、renderer、单元测试
│  └─ demo/              # Vite + React demo，含 Playwright smoke tests
├─ test-fixtures/        # EPUB 样本、快照、测试说明
├─ docs/                 # 当前项目内补充文档
├─ docs-pretext-epub-20260414/
│  ├─ 技术文档.md
│  ├─ 需求文档.md
│  ├─ 开发任务文档.md
│  └─ ...                # 能力矩阵、渲染策略、任务拆分等
└─ package.json
```

## 快速开始

### 环境要求

- Node.js `>= 18.17.0`，推荐 Node 20+
- `pnpm@10`

### 安装依赖

```bash
pnpm install
```

### 本地启动 demo

```bash
pnpm dev
```

启动后用浏览器打开终端里显示的 Vite 地址，通常是 `http://localhost:5173`。demo 支持直接选择本地 `.epub` 文件进行阅读、搜索、翻页、书签和高亮验证。

## 常用命令

```bash
pnpm dev          # 启动 demo
pnpm build        # 构建所有 workspace 包
pnpm test         # 运行 Vitest
pnpm test:e2e     # 运行 Playwright
pnpm typecheck    # TypeScript 类型检查
pnpm lint         # ESLint
pnpm ci:check     # 本地完整校验
```

如果只想验证某个包：

```bash
pnpm --filter @pretext-epub/core test
pnpm --filter @pretext-epub/demo build
```

## 作为核心库使用

`@pretext-epub/core` 暴露了解析、阅读 runtime 和多种领域类型。一个最小浏览器接入示意如下：

```ts
import { EpubReader } from "@pretext-epub/core"

const container = document.getElementById("reader")
const file = fileInput.files?.[0]

if (!container || !file) {
  throw new Error("Missing container or EPUB file")
}

const reader = new EpubReader({
  container,
  mode: "scroll"
})

await reader.open(file)
await reader.render()

const dispose = reader.on("relocated", ({ locator }) => {
  console.log("current locator:", locator)
})

const results = await reader.search("keyword")
if (results[0]) {
  await reader.goToSearchResult(results[0])
}

const bookmark = reader.createBookmark()
if (bookmark) {
  await reader.restoreBookmark(bookmark)
}

dispose()
reader.destroy()
```

根导出见 [packages/core/src/index.ts](packages/core/src/index.ts)。

## 测试与样本

- Core 单测位于 [packages/core/test](packages/core/test)
- Demo E2E 位于 [packages/demo/e2e](packages/demo/e2e)
- EPUB 样本位于 [test-fixtures/books](test-fixtures/books)

当前样本覆盖的重点包括：

- 最小可解析 EPUB
- 常见 reflowable 结构兼容性
- `canvas / dom` 混合渲染 fallback
- 固定版式 spread smoke 场景

可先从这些说明文件进入：

- [test-fixtures/README.md](test-fixtures/README.md)
- [test-fixtures/books/README.md](test-fixtures/books/README.md)

## 关键文档

如果你要继续开发这个仓库，优先看这些文档：

- [技术文档](docs-pretext-epub-20260414/技术文档.md)
- [开发任务文档](docs-pretext-epub-20260414/开发任务文档.md)
- [Reader Capability Matrix](docs-pretext-epub-20260414/2026-04-18-reader-capability-matrix.md)
- [真实 EPUB QA 记录](docs/real-books-qa-2026-04-18.md)

## 当前边界

以下方向在仓库里有明确边界，不应默认视为“已经支持”：

- `DRM / LCP`：当前阶段不做
- `OPDS`：不属于当前核心范围
- `Media Overlay`：暂未进入当前阶段
- 完整产品化的 RTL、FXL、Spread、TTS：已有基础入口，但不是完整闭环

如果你要继续扩展功能，建议先更新 capability matrix，再进入实现。
