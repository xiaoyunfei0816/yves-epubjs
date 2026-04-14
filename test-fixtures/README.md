# Test Fixtures

本目录用于存放 EPUB 解析、布局、搜索、导航相关测试资源。

目录约定：

- `books/`：测试书籍样本与配套说明
- `snapshots/`：解析结果快照、布局结果快照、必要的截图基线

命名规则：

- 书籍目录使用 kebab-case，例如 `minimal-book`
- 快照文件名使用 `模块名.场景名.snap.json`
- 样本说明文件统一为 `README.md`

使用原则：

- fixture 必须可长期重复使用，避免依赖外部网络
- 样本规模尽量小，但要覆盖明确场景
- 新增 fixture 时需注明用途与覆盖的需求点
