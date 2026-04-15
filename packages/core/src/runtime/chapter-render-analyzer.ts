import type { ChapterAnalysisInput } from "./chapter-analysis-input";
import type { ChapterRenderDecision } from "../model/types";
import {
  createChapterRenderDecision
} from "./chapter-render-decision";

export const HIGH_RISK_TAGS = [
  "table",
  "svg",
  "math",
  "iframe"
] as const;

export const COMPLEX_STYLE_PROPERTIES = [
  "float",
  "position",
  "flex",
  "grid"
] as const;

export type ChapterRenderAnalyzerConfig = {
  domThreshold: number;
  deepNestThreshold: number;
  imageDenseThreshold: number;
  largeNodeCountThreshold: number;
  complexInlineStyleThreshold: number;
};

export const DEFAULT_CHAPTER_RENDER_ANALYZER_CONFIG: ChapterRenderAnalyzerConfig = {
  domThreshold: 20,
  deepNestThreshold: 6,
  imageDenseThreshold: 8,
  largeNodeCountThreshold: 300,
  complexInlineStyleThreshold: 12
};

export function collectHighRiskTagReasons(
  input: Pick<ChapterAnalysisInput, "tagCounts">
): string[] {
  const reasons: string[] = [];

  for (const tagName of HIGH_RISK_TAGS) {
    if ((input.tagCounts[tagName] ?? 0) > 0) {
      reasons.push(`high-risk-tag:${tagName}`);
    }
  }

  return reasons;
}

export function collectComplexStyleReasons(
  input: Pick<ChapterAnalysisInput, "stylePropertyCounts">
): string[] {
  const reasons: string[] = [];

  for (const property of COMPLEX_STYLE_PROPERTIES) {
    if (hasComplexStyleProperty(input.stylePropertyCounts, property)) {
      reasons.push(`complex-style:${property}`);
    }
  }

  return reasons;
}

export function scoreChapterComplexity(
  input: ChapterAnalysisInput,
  config: Partial<ChapterRenderAnalyzerConfig> = {}
): { score: number; reasons: string[] } {
  const resolvedConfig = {
    ...DEFAULT_CHAPTER_RENDER_ANALYZER_CONFIG,
    ...config
  };
  const reasons: string[] = [];
  let score = 0;

  for (const reason of collectHighRiskTagReasons(input)) {
    reasons.push(reason);
    score += 20;
  }

  for (const reason of collectComplexStyleReasons(input)) {
    reasons.push(reason);
    score += 15;
  }

  if (input.maxDepth > resolvedConfig.deepNestThreshold) {
    reasons.push(`deep-nest:${input.maxDepth}`);
    score += 5;
  }

  const imageCount = input.tagCounts.img ?? 0;
  if (imageCount >= resolvedConfig.imageDenseThreshold) {
    reasons.push(`image-dense:${imageCount}`);
    score += 8;
  }

  if (input.nodeCount >= resolvedConfig.largeNodeCountThreshold) {
    reasons.push(`large-node-count:${input.nodeCount}`);
    score += 5;
  }

  if (input.inlineStyleDeclarationCount >= resolvedConfig.complexInlineStyleThreshold) {
    reasons.push(`complex-inline-style:${input.inlineStyleDeclarationCount}`);
    score += 10;
  }

  return {
    score,
    reasons
  };
}

export function analyzeChapterRenderMode(
  input: ChapterAnalysisInput,
  config: Partial<ChapterRenderAnalyzerConfig> = {}
): ChapterRenderDecision {
  const resolvedConfig = {
    ...DEFAULT_CHAPTER_RENDER_ANALYZER_CONFIG,
    ...config
  };
  const scored = scoreChapterComplexity(input, resolvedConfig);

  return createChapterRenderDecision({
    mode: scored.score >= resolvedConfig.domThreshold ? "dom" : "canvas",
    score: scored.score,
    reasons: scored.reasons
  });
}

function hasComplexStyleProperty(
  stylePropertyCounts: Record<string, number>,
  property: (typeof COMPLEX_STYLE_PROPERTIES)[number]
): boolean {
  if ((stylePropertyCounts[property] ?? 0) > 0) {
    return true;
  }

  if (property === "flex") {
    return (stylePropertyCounts.display ?? 0) > 0;
  }

  if (property === "grid") {
    return (stylePropertyCounts.display ?? 0) > 0;
  }

  return false;
}
