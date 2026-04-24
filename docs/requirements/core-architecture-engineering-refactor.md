# Core Architecture Engineering Refactor Requirements

Date: 2026-04-24

## Background

`packages/core` already covers parsing, layout, rendering, navigation,
selection, annotation, search, resources, and reader preferences. The feature
surface is broad, but several implementation paths now converge through
`EpubReader`, large renderer/layout modules, and tests that directly mutate
private runtime fields.

This refactor is architectural and engineering-only. It must not change reader
behavior, public reading workflows, EPUB parsing output, layout decisions, or
demo UI behavior.

## Goals

1. Reduce future change risk around `EpubReader` by moving isolated helper logic
   out of the class when the behavior has a clear single responsibility.
2. Improve test maintainability by replacing repeated private-field mutation
   patterns with a shared test harness.
3. Document stable boundaries so future work has an explicit place to attach
   code instead of adding more state and methods directly to `EpubReader`.
4. Keep the current public API and runtime behavior intact for this iteration.

## Non-Goals

1. Do not shrink or rename public exports in this iteration.
2. Do not change pagination, scroll, locator, search, annotation, or rendering
   behavior.
3. Do not introduce new dependencies or framework patterns.
4. Do not do a broad rewrite of `EpubReader`, `LayoutEngine`,
   `DisplayListBuilder`, or `CanvasRenderer`.

## Current Issues

### EpubReader Owns Too Much State

`EpubReader` owns parser, layout, renderers, resources, navigation, scroll
windowing, pagination, selection, annotation, search, preferences, and event
emission. This creates high blast radius for small behavior changes.

### Controller Boundaries Are Callback-Heavy

The existing render, navigation, and interaction controllers are useful but
still depend on large callback bags into `EpubReader`. This means orchestration
code is split while state ownership remains centralized.

### Test Setup Mutates Private Runtime State

Many tests assign `book`, `chapterRenderInputs`, `sourceName`, and related
private fields through casts. This makes refactoring internal fields harder than
it should be.

### Browser-Specific Logic Is Mixed Into Runtime Helpers

Canvas text-layer locator behavior currently lives in `EpubReader`, even though
it is a browser DOM utility with a narrow responsibility.

## Target Boundary Rules

1. `EpubReader` remains the public facade and lifecycle owner.
2. Isolated DOM/canvas helper logic should live in focused runtime modules.
3. Tests that need an opened synthetic book should use a harness instead of
   repeating private-field casts.
4. Public exports remain stable until a separate API-surface task explicitly
   designs a migration.

## Acceptance Criteria

1. Documentation exists for the architectural direction and this iteration's
   task scope.
2. A shared reader test harness exists and is used by at least one high-value
   reader test file.
3. Canvas text-layer locator helpers are extracted from `EpubReader` into a
   focused module without changing behavior.
4. Focused tests and full core verification pass.
