import type { SectionDocument } from "../model/types";
import { parseXhtmlDocument } from "../parser/xhtml-parser";
import {
  preprocessChapterDocument,
  type PreprocessedChapter
} from "./chapter-preprocess";

export type SharedChapterRenderInput = {
  href: string;
  content: string;
  preprocessed: PreprocessedChapter;
};

export type CanvasChapterRenderInput = {
  kind: "canvas";
  href: string;
  preprocessed: PreprocessedChapter;
  section: SectionDocument;
};

export type DomChapterRouteInput = {
  kind: "dom";
  href: string;
  preprocessed: PreprocessedChapter;
  chapter: PreprocessedChapter;
};

export function createSharedChapterRenderInput(input: {
  href: string;
  content: string;
}): SharedChapterRenderInput {
  return {
    href: input.href,
    content: input.content,
    preprocessed: preprocessChapterDocument(input)
  };
}

export function toCanvasChapterRenderInput(
  input: SharedChapterRenderInput
): CanvasChapterRenderInput {
  return {
    kind: "canvas",
    href: input.href,
    preprocessed: input.preprocessed,
    section: parseXhtmlDocument(input.content, input.href)
  };
}

export function toDomChapterRenderInput(
  input: SharedChapterRenderInput
): DomChapterRouteInput {
  return {
    kind: "dom",
    href: input.href,
    preprocessed: input.preprocessed,
    chapter: input.preprocessed
  };
}
