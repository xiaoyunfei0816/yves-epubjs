# @yves-epub/core

浏览器 EPUB 阅读器引擎，提供 EPUB 解析、章节模型、混合渲染、阅读定位、搜索、书签、批注、偏好设置和诊断能力。

这个包只提供阅读器核心。宿主应用负责书架、账号、文件来源、持久化、权限、外链策略和产品 UI。

## 安装

```bash
npm install @yves-epub/core
```

如果使用 pnpm：

```bash
pnpm add @yves-epub/core
```

## 能力概览

- 输入：支持 `File`、`Blob`、`ArrayBuffer`、`Uint8Array`。
- 解析：解析 `container.xml`、OPF、NAV、NCX、XHTML、manifest、spine、metadata、TOC。
- 模型：输出 `Book`、`SectionDocument`、`Locator`、`Bookmark`、`Annotation` 等领域对象。
- 阅读模式：支持 `scroll` 和 `paginated`。
- 渲染后端：按章节选择 `canvas` 或 `dom`。简单 reflowable 章节优先走 `canvas`，复杂结构、固定版式、封面或单图页可回退到 `dom`。
- 导航：支持翻页、目录跳转、href 跳转、搜索命中跳转、全书进度跳转。
- 状态：支持阅读进度、分页信息、偏好设置、书签恢复、位置恢复诊断。
- 标注：支持 decoration、搜索高亮、当前选区快照、批注创建和批注视口快照。
- 诊断：暴露渲染后端、回退原因、布局来源、交互模型和可见章节信息。

## 最小接入

```ts
import { EpubReader } from "@yves-epub/core";

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

业务侧建议封装一个 reader controller，而不是把 `EpubReader` 实例散落在多个 UI 组件里。

1. 生命周期层：创建 reader、绑定事件、打开书籍、首次渲染、销毁实例。
2. 状态同步层：把 `getCurrentLocation()`、`getPaginationInfo()`、`getRenderMetrics()`、`getSettings()` 同步到宿主状态。
3. 持久化层：按 `publicationId` 保存 preferences、bookmark、last locator、annotations。
4. UI 动作层：把按钮、目录、搜索、字号、主题、批注操作映射为 reader 方法调用。
5. 容错层：捕获 `open()`、`render()`、恢复位置、搜索和偏好切换中的异常，给 UI 一个确定状态。

React 接入可以参考仓库中的 `packages/demo/src/use-reader-controller.ts`。

## 状态与操作

未创建：创建 `new EpubReader(options)`，绑定容器、事件、默认偏好，未加载书籍。

已创建：调用 `open(input)`，解析 EPUB，生成 `Book`，设置初始 locator，触发 `opened`。

已打开：调用 `render()`，选择章节渲染后端，绘制当前章节，触发 `rendered`。

已渲染：调用 `next()`、`prev()`、`goToPage()`、`goToLocation()`、`goToTocItem()`、`goToHref()`，改变位置，更新分页和进度，触发 `relocated`。

已渲染：调用 `search(query)`，生成 `SearchResult[]` 和搜索 decoration，触发 `searchCompleted`。

已渲染：调用 `submitPreferences(preferences)`，合并偏好，必要时重排或重渲染，触发 `preferencesChanged`、`themeChanged`、`typographyChanged`。

任意状态：调用 `destroy()`，移除监听、清理资源、释放 object URL。

异步屏障建议：

- `open()` 完成前只展示加载态。
- `render()` 完成前避免执行翻页、搜索、恢复位置和批注。
- 偏好切换、模式切换和字体变化会触发重排。宿主应等待 Promise 完成再更新可操作 UI。
- 位置恢复应在 `open()` 之后执行。需要立即可见结果时，在 `render()` 之后调用 `restoreLocation()` 或 `restoreBookmark()`。
- 组件卸载时先取消事件订阅，再调用 `destroy()`。

## 主要接口

生命周期：

- `open(input)`：打开 EPUB 输入，返回 `Book`。
- `render()`：渲染当前位置。
- `destroy()`：销毁实例并清理资源。
- `getBook()`：返回当前 `Book`。
- `getPublicationId()`：返回推导出的书籍身份。

导航与位置：

- `next()`、`prev()`：下一页或上一页。scroll 模式按章节推进。
- `goToPage(pageNumber)`：跳转到分页模式页码。
- `goToLocation(locator)`：跳转到精确位置。
- `restoreLocation(locator)`：从 `Locator` 或 `SerializedLocator` 恢复位置，返回是否成功。
- `goToTocItem(id)`：按 TOC id 跳转。
- `goToHref(href)`：按书内 href 跳转。
- `resolveHrefLocator(href)`：解析书内 href 对应 locator。
- `goToProgress(progress)`：按全书进度跳转。
- `getCurrentLocation()`：获取当前位置。
- `getReadingProgress()`：获取全书和章节进度。
- `getPaginationInfo()`：获取 `currentPage` 和 `totalPages`。

搜索、书签与批注：

- `search(query)`：全书搜索，返回 `SearchResult[]` 并写入搜索 decoration。
- `goToSearchResult(result)`：跳转到搜索结果。
- `createBookmark(input?)`：基于当前位置创建书签对象。
- `restoreBookmark(bookmark)`：恢复书签位置。
- `createAnnotation(input?)`：基于 locator 创建批注。
- `createAnnotationFromSelection(input?)`：基于当前选区创建批注。
- `addAnnotation(annotation)`：添加批注到运行时。
- `setAnnotations(annotations)`：批量替换批注。
- `getAnnotations()`：读取运行时批注。
- `clearAnnotations()`：清空批注。
- `getAnnotationViewportSnapshots()`：获取批注在当前视口中的映射。

偏好与样式：

- `submitPreferences(preferences)`：合并并应用偏好。
- `restorePreferences(preferencesOrString)`：从对象或序列化字符串恢复偏好。
- `serializePreferences()`：序列化当前偏好。
- `getPreferences()`：获取偏好对象。
- `getSettings()`：获取合并默认值后的设置。
- `setMode(mode)`：切换 `scroll` 或 `paginated`。
- `setTheme(theme)`：更新前景色和背景色。
- `setTypography(options)`：更新字号、行高、段距、字体、字距、词距。

映射、命中测试与诊断：

- `hitTest(point)`：根据视口点位识别链接、图片或文本块。
- `mapLocatorToViewport(locator)`：把 locator 映射为视口 rect。
- `mapViewportToLocator(point)`：把视口点位映射为 locator。
- `setDecorations(input)`：设置自定义视觉标记。
- `clearDecorations(group?)`：清除指定组或全部自定义标记。
- `getDecorations(group?)`：获取 decoration。
- `getRenderMetrics()`：获取当前渲染指标。
- `getRenderDiagnostics()`：获取当前章节渲染诊断。
- `getVisibleSectionDiagnostics()`：获取可见章节诊断。
- `getLastLocationRestoreDiagnostics()`：获取最近一次位置恢复诊断。
- `getTocTargets()`：获取扁平化目录目标。
- `getPublicationAccessibilitySnapshot()`：获取可访问性文本和结构快照。

## 常用类型

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
} from "@yves-epub/core";
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

生命周期：每个阅读容器对应一个 `EpubReader` 实例。打开新书时可以复用实例，但要重新执行 `open()` 和 `render()`。React 组件卸载时取消所有 `on()` 返回的订阅函数，然后调用 `destroy()`。

持久化：引擎只返回可持久化对象，不替宿主写数据库或 localStorage。建议按 `publicationId` 分桶保存 `preferences`、`lastLocator`、`bookmark` 和 `annotations`。

偏好更新：优先使用 `submitPreferences()`。它会合并现有偏好并返回最终 `ReaderSettings`。宿主 UI 应以返回值或 `preferencesChanged` 事件为准。

位置恢复：推荐顺序是 `open()`、`render()`、`restoreLocation()` 或 `restoreBookmark()`，然后读取 `getLastLocationRestoreDiagnostics()` 判断是否精确命中或 fallback。

搜索：`search(query)` 会返回结果并生成 `search-results` decoration。宿主清空搜索时应调用 `clearDecorations("search-results")`。

批注：选区高亮优先使用 `createAnnotationFromSelection()` 或 `applyCurrentSelectionHighlightAction()`。宿主保存批注后，通过 `setAnnotations()` 在重新打开书籍时恢复。

诊断：排查真实 EPUB 时优先读取 `getRenderMetrics()`、`getRenderDiagnostics()`、`getVisibleSectionDiagnostics()`。

## 当前边界

当前阶段聚焦 EPUB 阅读内核。以下能力属于明确边界：

- DRM、LCP：当前不处理授权、解密和受保护内容。
- OPDS：当前不处理在线书库发现、分发和下载协议。
- Media Overlay：当前不处理音频和文本时间轴同步。
- TTS：当前不内置朗读引擎。
- 完整产品化书架：当前仓库的 demo 只用于验证阅读器能力。
- 完整 FXL 产品体验：已有固定版式、封面、单图页和 spread 基础能力，仍应按具体书籍继续做真实样本回归。

## 许可证

MIT

## 仓库

GitHub: https://github.com/xiaoyunfei0816/yves-epubjs
