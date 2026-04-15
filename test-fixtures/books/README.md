# Books Fixtures

本目录存放用于自动化测试的 EPUB 样本。

规划中的样本类型：

- `minimal-book`：最小可解析 EPUB 结构
- `cjk-mixed-book`：中英文混排
- `image-book`：包含图片资源
- `footnote-book`：包含脚注与锚点跳转
- `long-section-book`：包含长章节，验证虚拟化与性能

当前阶段先提供一个最小占位样本目录，后续在 B2、C2、C3 等任务中逐步补成真实 `.epub` 或解包后的测试资源。

当前新增：

- `reflowable-compat`：常见文本书章节样本，覆盖 inline、figure、list、table、footnote、definition-list
- `hybrid-render-fallback`：章节级 `canvas/dom` fallback 样本，覆盖线性章节与复杂章节分流
