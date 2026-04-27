# Pretext EPUB Reader Engine

`pretext-epub` 是一个面向浏览器宿主的 EPUB 阅读器引擎。它提供 EPUB 解析、章节模型、混合渲染、阅读定位、搜索、书签、批注、偏好设置和诊断能力。宿主应用负责书架、账号、文件来源、持久化、权限和产品 UI。

当前仓库包含两个 workspace package：

- `@pretext-epub/core`：阅读器核心。负责 EPUB 输入、解析、布局、渲染和运行时状态。
- `@pretext-epub/demo`：Vite 和 React demo。用于验证真实浏览器交互、样式切换、搜索、书签、批注和回归场景。

这个项目的定位是“阅读器引擎 + 验证平台”。它适合被包装进业务阅读器、内容平台、内部文档系统或电子书实验项目。

## 核心能力

引擎把 EPUB 阅读拆成几条明确链路：

- 输入：支持 `File`、`Blob`、`ArrayBuffer`、`Uint8Array`。
- 解析：解析 `container.xml`、OPF、NAV、NCX、XHTML、manifest、spine、metadata、TOC。
- 模型：输出统一的 `Book`、`SectionDocument`、`Locator`、`Bookmark`、`Annotation` 等领域对象。
- 渲染：支持 `scroll` 和 `paginated` 两种阅读模式。
- 后端：按章节选择 `canvas` 或 `dom`。简单 reflowable 章节优先走 `canvas`，复杂结构、固定版式、封面或单图页可回退到 `dom`。
- 定位：使用 `Locator` 描述章节、进度、锚点、块、内联偏移和 CFI 入口。
- 交互：支持翻页、目录跳转、href 跳转、搜索命中跳转、viewport 映射、hit test。
- 阅读状态：支持阅读进度、分页信息、偏好设置、书签恢复、位置恢复诊断。
- 标注：支持 decoration、搜索高亮、当前选区快照、批注创建、批注视口快照。
- 诊断：暴露渲染后端、路由原因、布局来源、交互模型、可见章节信息。

## 快速开始

环境要求：

- Node.js `>= 18.17.0`
- `pnpm@10`

安装依赖：

```bash
pnpm install
```

启动 demo：

```bash
pnpm dev
```

常用校验：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm ci:check
```

只验证某个包时可以使用 workspace filter 的短参数：

```bash
pnpm -F @pretext-epub/core test
pnpm -F @pretext-epub/demo build
```

## 最小接入

宿主只需要提供一个容器元素和 EPUB 二进制输入。

```ts
import { EpubReader } from "@pretext-epub/core";

const container = document.getElementById("reader");
const file = fileInput.files?.[0];

if (!container || !file) {
  throw new Error("Missing reader container or EPUB file");
}

const reader = new EpubReader({
  container,
  preferences: {
    mode: "scroll",
    publisherStyles: "enabled",
    typography: {
      fontSize: 18,
      lineHeight: 1.6
    }
  },
  onExternalLink: ({ href }) => {
    window.open(href, "_blank", "noopener,noreferrer");
  }
});

const offRelocated = reader.on("relocated", ({ locator }) => {
  localStorage.setItem("lastLocator", JSON.stringify(locator));
});

await reader.open(file);
await reader.render();

const results = await reader.search("keyword");
if (results[0]) {
  await reader.goToSearchResult(results[0]);
}

const bookmark = reader.createBookmark({ label: "last read" });
if (bookmark) {
  localStorage.setItem(
    `bookmark:${bookmark.publicationId}`,
    JSON.stringify(bookmark)
  );
}

offRelocated();
reader.destroy();
```

## 推荐宿主封装

建议业务侧不要把 `EpubReader` 直接散落在多个组件里。更稳妥的方式是封装一个 reader controller：

1. 生命周期层：创建 reader、绑定事件、打开书籍、首次渲染、销毁实例。
2. 状态同步层：把 `getCurrentLocation()`、`getPaginationInfo()`、`getRenderMetrics()`、`getSettings()` 同步到宿主状态。
3. 持久化层：按 `publicationId` 保存 preferences、bookmark、last locator、annotations。
4. UI 动作层：把按钮、目录、搜索、字号、主题、批注操作映射为 reader 方法调用。
5. 容错层：捕获 `open()`、`render()`、恢复位置、搜索和偏好切换中的异常，给 UI 一个确定状态。

React 项目可以参考 [packages/demo/src/use-reader-controller.ts](packages/demo/src/use-reader-controller.ts)。这个文件展示了事件订阅、偏好恢复、书签恢复、搜索结果、批注和可见快照的完整主路径。

## 状态与操作矩阵

阅读器是状态驱动对象。宿主集成时应按当前状态限制操作。

未创建：创建 `new EpubReader(options)`，绑定容器、事件、默认偏好，未加载书籍。

已创建：调用 `open(input)`，解析 EPUB，生成 `Book`，设置初始 locator，触发 `opened`。

已打开：调用 `render()`，选择章节渲染后端，绘制当前章节，触发 `rendered`。

已渲染：调用 `next()`、`prev()`、`goToPage()`、`goToLocation()`、`goToTocItem()`、`goToHref()`，改变位置，更新分页和进度，触发 `relocated`。

已渲染：调用 `search(query)`，生成 `SearchResult[]` 和搜索 decoration，触发 `searchCompleted`。

已渲染：调用 `submitPreferences(preferences)`，合并偏好，必要时重排或重渲染，触发 `preferencesChanged`、`themeChanged`、`typographyChanged`。

已渲染：调用 `createBookmark()`、`createAnnotation()`，返回可持久化对象。宿主负责保存。

已渲染：调用 `setAnnotations()`、`setDecorations()`，更新视觉标记并保留阅读位置。

任意状态：调用 `destroy()`，移除监听、清理资源、释放 object URL。

异步屏障建议：

- `open()` 完成前只展示加载态。
- `render()` 完成前避免执行翻页、搜索、恢复位置和批注。
- 偏好切换、模式切换和字体变化会触发重排。宿主应等待 Promise 完成再更新可操作 UI。
- 位置恢复应在 `open()` 之后执行。需要立即可见结果时，在 `render()` 之后调用 `restoreLocation()` 或 `restoreBookmark()`。
- 组件卸载时先取消事件订阅，再调用 `destroy()`。

## 主要接口

### 构造参数

```ts
type ReaderOptions = {
  container?: HTMLElement;
  canvas?: HTMLCanvasElement;
  preferences?: ReaderPreferences;
  mode?: "scroll" | "paginated";
  theme?: Partial<Theme>;
  typography?: Partial<TypographyOptions>;
  onTextSelectionChanged?: (
    input: ReaderEventMap["textSelectionChanged"]
  ) => void | Promise<void>;
  onPaginatedCenterTap?: (
    input: ReaderEventMap["paginatedCenterTapped"]
  ) => void | Promise<void>;
  onExternalLink?: (
    input: ReaderEventMap["externalLinkActivated"]
  ) => void | Promise<void>;
  onSectionRendered?: (input: SectionRenderedEvent) => void | Promise<void>;
  onSectionRelocated?: (input: SectionRelocatedEvent) => void | Promise<void>;
};
```

### 文件与生命周期

`open(input)`：打开 EPUB 输入，返回 `Book`。

`render()`：渲染当前位置。

`destroy()`：销毁实例并清理资源。

`getBook()`：返回当前 `Book`。

`getPublicationId()`：返回推导出的书籍身份。

### 导航与位置

`next()`、`prev()`：下一页或上一页。scroll 模式按章节推进。

`goToPage(pageNumber)`：跳转到分页模式页码。

`goToLocation(locator)`：跳转到精确位置。

`restoreLocation(locator)`：从 `Locator` 或 `SerializedLocator` 恢复位置，返回是否成功。

`goToTocItem(id)`：按 TOC id 跳转。

`goToHref(href)`：按书内 href 跳转。

`resolveHrefLocator(href)`：解析书内 href 对应 locator。

`goToProgress(progress)`：按全书进度跳转。

`getCurrentLocation()`：获取当前位置。

`getReadingProgress()`：获取全书和章节进度。

`getPaginationInfo()`：获取 `currentPage` 和 `totalPages`。

### 搜索、书签与批注

`search(query)`：全书搜索，返回 `SearchResult[]` 并写入搜索 decoration。

`goToSearchResult(result)`：跳转到搜索结果。

`createBookmark(input?)`：基于当前位置创建书签对象。

`restoreBookmark(bookmark)`：恢复书签位置。

`createAnnotation(input?)`：基于 locator 创建批注。

`createAnnotationFromSelection(input?)`：基于当前选区创建批注。

`addAnnotation(annotation)`：添加批注到运行时。

`setAnnotations(annotations)`：批量替换批注。

`getAnnotations()`：读取运行时批注。

`clearAnnotations()`：清空批注。

`getAnnotationViewportSnapshots()`：获取批注在当前视口中的映射。

### 偏好与样式

`submitPreferences(preferences)`：合并并应用偏好。

`restorePreferences(preferencesOrString)`：从对象或序列化字符串恢复偏好。

`serializePreferences()`：序列化当前偏好。

`getPreferences()`：获取偏好对象。

`getSettings()`：获取合并默认值后的设置。

`setMode(mode)`：切换 `scroll` 或 `paginated`。

`setTheme(theme)`：更新前景色和背景色。

`setTypography(options)`：更新字号、行高、段距、字体、字距、词距。

### 映射、命中测试与诊断

`hitTest(point)`：根据视口点位识别链接、图片或文本块。

`mapLocatorToViewport(locator)`：把 locator 映射为视口 rect。

`mapViewportToLocator(point)`：把视口点位映射为 locator。

`setDecorations(input)`：设置自定义视觉标记。

`clearDecorations(group?)`：清除指定组或全部自定义标记。

`getDecorations(group?)`：获取 decoration。

`getRenderMetrics()`：获取当前渲染指标。

`getRenderDiagnostics()`：获取当前章节渲染诊断。

`getVisibleSectionDiagnostics()`：获取可见章节诊断。

`getLastLocationRestoreDiagnostics()`：获取最近一次位置恢复诊断。

`getTocTargets()`：获取扁平化目录目标。

`getPublicationAccessibilitySnapshot()`：获取可访问性文本和结构快照。

### 事件

`reader.on(event, handler)` 返回取消订阅函数。

`opened`：EPUB 已解析为 `Book`。

`rendered`：当前内容已渲染。

`relocated`：阅读位置变化。

`paginatedCenterTapped`：分页模式中部点击。

`textSelectionChanged`：文本选区变化。

`externalLinkActivated`：外链被激活。

`externalLinkBlocked`：外链因 unsafe scheme 被阻止。

`preferencesChanged`：偏好变化。

`themeChanged`：主题变化。

`typographyChanged`：排版参数变化。

`searchCompleted`：搜索完成。

## 类型模型

常用类型从 `@pretext-epub/core` 根入口导出：

```ts
import type {
  Annotation,
  Bookmark,
  Book,
  Locator,
  ReaderPreferences,
  ReaderSettings,
  SearchResult,
  SectionDocument,
  Theme,
  TypographyOptions
} from "@pretext-epub/core";
```

`Locator` 是阅读器最重要的位置协议：

```ts
type Locator = {
  spineIndex: number;
  blockId?: string;
  anchorId?: string;
  inlineOffset?: number;
  cfi?: string;
  progressInSection?: number;
};
```

宿主保存阅读位置时建议保存 `SerializedLocator`、`publicationId` 和时间戳。恢复时先校验 `publicationId`，再调用 `restoreLocation()` 或 `restoreBookmark()`。

## 最佳实践

### 生命周期

每个阅读容器对应一个 `EpubReader` 实例。打开新书时可以复用实例，但要重新执行 `open()` 和 `render()`。React 组件卸载时取消所有 `on()` 返回的订阅函数，然后调用 `destroy()`。

### 持久化

引擎只返回可持久化对象，不替宿主写数据库或 localStorage。建议按 `publicationId` 分桶保存：

- `preferences`：用户阅读偏好，可全局保存，也可按书覆盖。
- `lastLocator`：最后阅读位置，用于自动续读。
- `bookmark`：用户显式保存的位置。
- `annotations`：高亮、下划线、笔记。

### 偏好更新

优先使用 `submitPreferences()`。它会合并现有偏好并返回最终 `ReaderSettings`。宿主 UI 应以返回值或 `preferencesChanged` 事件为准，避免 UI 状态和引擎实际设置分叉。

```ts
const settings = await reader.submitPreferences({
  mode: "paginated",
  typography: {
    fontSize: 20
  }
});

persistPreferences(reader.getPublicationId(), reader.getPreferences());
syncUiFromSettings(settings);
```

### 位置恢复

恢复顺序建议：

1. `await reader.open(input)`
2. `await reader.render()`
3. `await reader.restoreLocation(savedLocator)` 或 `await reader.restoreBookmark(bookmark)`
4. 读取 `getLastLocationRestoreDiagnostics()` 判断是否精确命中或 fallback

当恢复失败时，宿主可以保留当前初始位置，并给用户一个温和提示。

### 搜索

`search(query)` 会返回结果并生成 `search-results` decoration。宿主清空搜索时应同步清理：

```ts
reader.clearDecorations("search-results");
```

搜索结果跳转使用 `goToSearchResult(result)`。它会处理 canvas 和 dom 两种渲染路径下的位置对齐。

### 批注与高亮

选区高亮优先使用 `createAnnotationFromSelection()` 或 `applyCurrentSelectionHighlightAction()`。宿主保存批注后，通过 `setAnnotations()` 在重新打开书籍时恢复。

```ts
const annotation = reader.createAnnotationFromSelection({
  color: "#3b82f6"
});

if (annotation) {
  reader.addAnnotation(annotation);
  persistAnnotation(annotation);
}
```

### 外链

书内 href 通过 `goToHref()` 或默认点击逻辑处理。外链通过 `onExternalLink` 或 `externalLinkActivated` 事件交给宿主。宿主应自行决定是否打开新窗口、记录审计或展示确认。

### 渲染诊断

在排查真实 EPUB 时优先读取：

```ts
reader.getRenderMetrics();
reader.getRenderDiagnostics();
reader.getVisibleSectionDiagnostics();
```

这些信息能回答当前章节走 `canvas` 还是 `dom`、为什么回退、当前布局来源是什么、是否启用 synthetic spread。

## 当前边界

当前阶段聚焦 EPUB 阅读内核。以下能力属于明确边界：

- DRM、LCP：当前不处理授权、解密和受保护内容。
- OPDS：当前不处理在线书库发现、分发和下载协议。
- Media Overlay：当前不处理音频和文本时间轴同步。
- TTS：当前不内置朗读引擎。
- 完整产品化书架：当前 demo 只用于验证阅读器能力。
- 完整 FXL 产品体验：已有固定版式、封面、单图页和 spread 基础能力，仍应按具体书籍继续做真实样本回归。

## 仓库结构

```text
.
├─ packages
│  ├─ core              # EPUB 解析、模型、runtime、renderer、测试
│  └─ demo              # Vite + React demo 和 Playwright smoke tests
├─ test-fixtures        # EPUB 样本和测试说明
├─ docs                 # 当前项目补充文档
├─ docs-pretext-epub-20260414
│  └─ 需求、技术、任务和能力矩阵文档
└─ package.json
```

## 测试

- Core 单测：[packages/core/test](packages/core/test)
- Demo E2E：[packages/demo/e2e](packages/demo/e2e)
- EPUB 样本：[test-fixtures/books](test-fixtures/books)

修改解析、定位、分页、渲染、TOC、搜索、批注或偏好时，优先补 core 测试。涉及浏览器交互时同步补 demo E2E。

本地完整校验：

```bash
pnpm ci:check
```

## 公开导出

`@pretext-epub/core` 根入口导出分为两类：

- 稳定集成入口：`model/types`、`runtime/reader`、`runtime/bookmark`、`runtime/annotation`、`runtime/locator`、`runtime/preferences`、`runtime/publisher-styles`、`runtime/reading-language`、`runtime/reading-spread`、`runtime/accessibility`、`container/*`。
- 兼容导出入口：parser、layout、renderer 和章节渲染决策相关模块。它们便于高级宿主扩展和测试，但更接近内部机制。

公开导出边界由 [packages/core/test/public-api-surface.test.ts](packages/core/test/public-api-surface.test.ts) 约束。

## 相关文档

- [AGENTS.md](AGENTS.md)
- [test-fixtures/README.md](test-fixtures/README.md)
- [test-fixtures/books/README.md](test-fixtures/books/README.md)
- [docs/real-books-qa-2026-04-18.md](docs/real-books-qa-2026-04-18.md)
