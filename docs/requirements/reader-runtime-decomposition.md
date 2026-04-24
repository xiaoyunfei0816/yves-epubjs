# Reader Runtime Decomposition Requirements

Date: 2026-04-24

## Background

`packages/core/src/runtime/reader.ts` remains the public reader facade, but it
has accumulated parsing lifecycle, render orchestration, pagination, scroll
positioning, DOM geometry, resource resolution, search, annotations, selection,
and event integration in one large class.

The previous engineering refactor established two low-risk boundaries:

1. A shared test harness for synthetic reader setup.
2. A dedicated `canvas-text-locator` module for canvas text-layer DOM helpers.

This iteration continues the same direction by moving larger coherent runtime
responsibilities out of `reader.ts` while preserving behavior.

## Goals

1. Keep `EpubReader` as the only public facade.
2. Move pagination/spread calculation out of `reader.ts` into a focused runtime
   module.
3. Move reader session state construction into a focused state factory so field
   defaults have one owner.
4. Keep behavior, public exports, and demo integration unchanged.
5. Validate each step with focused tests before running full core verification.

## Non-Goals

1. Do not rename or remove public `EpubReader` methods.
2. Do not change pagination, spread, scroll, locator, search, annotation, or
   rendering semantics.
3. Do not introduce new dependencies.
4. Do not force a complete rewrite of all reader responsibilities in one pass.

## Target Boundaries

### EpubReader

Owns public API, lifecycle sequencing, service wiring, and event emission.

### Reader Session State

Owns default construction of grouped mutable runtime state such as document,
view, position, render, and selection state.

### Reader Pagination Module

Owns page lookup, locator-to-page mapping, display spread calculation, visible
spread traversal, and page-derived locator/progress helpers.

### Reader Block Tree Utilities

Owns shared block-id lookup and renderable-block resolution used by both
pagination and reader annotation/selection flows.

### Reader Selection Utilities

Owns pure text-selection snapshot cloning/equality and text-range flattening,
inflation, normalization, and subtraction helpers. `EpubReader` still owns DOM
selection orchestration and event emission.

## Acceptance Criteria

1. New requirement and task documents exist.
2. `reader.ts` delegates pagination/spread helper logic to a dedicated module.
3. Reader state defaults are created through a dedicated state factory.
4. Pure text-selection utility logic lives outside `reader.ts`.
5. Existing focused reader tests pass after each implementation step.
6. Final core typecheck, lint, focused tests, and full core test pass.
