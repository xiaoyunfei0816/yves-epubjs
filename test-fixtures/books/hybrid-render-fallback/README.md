# Hybrid Render Fallback Fixtures

本目录存放“章节级 `canvas/dom` fallback”阶段的最小章节样本。

## 覆盖场景

- `canvas-linear.xhtml`：线性正文结构，预期继续走 `canvas`
- `dom-complex.xhtml`：包含 `table` 与高风险样式，预期整章走 `dom`

## 使用约束

- 所有样本均为解包后的 XHTML 章节
- `fixture-info.json` 明确记录每个章节的 `expectedMode`
- analyzer、runtime 和 demo 都应优先复用这组样本做章节级 fallback 回归
