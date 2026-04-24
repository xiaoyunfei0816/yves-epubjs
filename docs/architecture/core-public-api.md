# Core Public API Surface

Date: 2026-04-24

## Purpose

This document classifies the current root exports from
`packages/core/src/index.ts` so architecture refactors can distinguish stable
API from compatibility exports and internal implementation modules.

No export is removed by this document. It is a guardrail for future work.

## Stable Public API

These exports are intended to remain the primary public surface:

1. `./model/types`
2. `./runtime/reader`
3. `./runtime/bookmark`
4. `./runtime/annotation`
5. `./runtime/locator`
6. `./runtime/preferences`
7. `./runtime/publisher-styles`
8. `./runtime/reading-language`
9. `./runtime/reading-spread`
10. `./runtime/accessibility`
11. `./container/resource-container`
12. `./container/normalize-input`
13. `./container/resource-path`
14. `./container/resource-mime`

## Compatibility Exports

These exports are currently available from the package root and should keep
working until an explicit API migration task changes that policy. New external
consumers should not be encouraged to depend on them as stable API.

1. `./runtime/chapter-preprocess`
2. `./runtime/chapter-analysis-input`
3. `./runtime/chapter-render-decision`
4. `./runtime/chapter-render-input`
5. `./runtime/chapter-render-analyzer`
6. `./runtime/chapter-render-decision-cache`
7. `./parser/book-parser`
8. `./parser/container-parser`
9. `./parser/nav-parser`
10. `./parser/ncx-parser`
11. `./parser/opf-parser`
12. `./parser/inline-parser`
13. `./parser/html-dom-adapter`
14. `./parser/css-ast-adapter`
15. `./parser/css-resource-loader`
16. `./parser/selector-matcher`
17. `./parser/style-rule-matcher`
18. `./parser/style-resolver`
19. `./parser/spine-content-parser`
20. `./parser/xhtml-dom-parser`
21. `./parser/xhtml-parser`
22. `./layout/layout-engine`
23. `./renderer/draw-ops`
24. `./renderer/display-list-builder`
25. `./renderer/canvas-renderer`
26. `./renderer/dom-chapter-renderer`
27. `./renderer/dom-chapter-style`
28. `./renderer/reading-style-profile`

## Internal Modules

Refactor support modules are intentionally not exported from
`packages/core/src/index.ts`. They may be tested directly through source paths,
but they are not public package API.

Current examples:

1. `./runtime/reader-annotation-service`
2. `./runtime/reader-dom-pagination-service`
3. `./runtime/reader-scroll-position-service`
4. `./runtime/reader-render-orchestrator`
5. `./runtime/render-flow-types`
6. `./model/locator-domain`
7. `./utils/url-boundary`

## Rules

1. Root exports must not grow accidentally.
2. Compatibility exports can be reclassified only through a documented API task.
3. Internal implementation modules should not be added to `src/index.ts`.
4. Tests may import internal modules directly from source paths when needed.
