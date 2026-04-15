# Reflowable Compatibility Fixtures

本目录存放“90% 常见 reflowable EPUB 文本书”兼容增强阶段使用的最小章节样本。

## 覆盖场景

- `novel-inline.xhtml`：正文段落、`mark`、`sup`、inline image
- `figure-note.xhtml`：`figure`、`figcaption`、`aside`
- `nested-list.xhtml`：有序/无序嵌套列表
- `table-data.xhtml`：表格标题、表头、基础单元格
- `footnotes.xhtml`：脚注引用、同章锚点
- `definition-list.xhtml`：`dl/dt/dd`

## 使用约束

- 所有样本均为解包后的 XHTML 章节，不依赖外部网络
- 每个样本至少有一个自动化测试直接读取
- 覆盖关系见 `fixture-info.json` 与兼容测试矩阵文档
