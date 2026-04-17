import { resolveResourcePath } from "../container/resource-path"
import type { Book, SectionDocument, Theme, TypographyOptions } from "../model/types"
import type { DomChapterRenderInput } from "../renderer/dom-chapter-renderer"
import type { SharedChapterRenderInput } from "./chapter-render-input"

type DomRenderInputFactoryOptions = {
  book: Book | null
  section: SectionDocument
  input: SharedChapterRenderInput
  theme: Theme
  typography: TypographyOptions
  fontFamily: string
  resolveDomResourceUrl: (path: string) => string
}

export function createDomChapterRenderInput(
  options: DomRenderInputFactoryOptions
): DomChapterRenderInput {
  const renderInput: DomChapterRenderInput = {
    sectionId: options.section.id,
    sectionHref: options.section.href,
    ...(options.section.presentationRole
      ? { presentationRole: options.section.presentationRole }
      : {}),
    linkedStyleSheets: (options.input.linkedStyleSheets ?? []).map((stylesheet) => ({
      href: stylesheet.href,
      text: resolveDomStyleSheetText(
        stylesheet.href,
        stylesheet.text,
        options.resolveDomResourceUrl
      )
    })),
    nodes: options.input.preprocessed.nodes,
    theme: options.theme,
    typography: options.typography,
    fontFamily: options.fontFamily,
    resolveAttributeValue: ({ tagName, attributeName, value }) =>
      resolveDomAttributeValue({
        sectionHref: options.section.href,
        tagName,
        attributeName,
        value,
        resolveDomResourceUrl: options.resolveDomResourceUrl
      })
  }

  const presentationImage = resolvePresentationSectionImage(options.book, options.section)
  if (!presentationImage) {
    return renderInput
  }

  return {
    ...renderInput,
    presentationImageSrc: options.resolveDomResourceUrl(presentationImage.src),
    ...(presentationImage.alt ? { presentationImageAlt: presentationImage.alt } : {})
  }
}

function resolveDomAttributeValue(input: {
  sectionHref: string
  tagName: string
  attributeName: string
  value: string
  resolveDomResourceUrl: (path: string) => string
}): string {
  const normalizedTagName = input.tagName.toLowerCase()
  const normalizedAttributeName = input.attributeName.toLowerCase()

  if (normalizedAttributeName === "style") {
    return resolveDomCssUrlValues(
      input.sectionHref,
      input.value,
      input.resolveDomResourceUrl
    )
  }

  if (
    !shouldResolveDomResourceAttribute(
      normalizedTagName,
      normalizedAttributeName
    )
  ) {
    return input.value
  }

  if (isExternalResourceValue(input.value)) {
    return input.value
  }

  return input.resolveDomResourceUrl(resolveResourcePath(input.sectionHref, input.value))
}

function shouldResolveDomResourceAttribute(
  tagName: string,
  attributeName: string
): boolean {
  if (
    attributeName === "src" &&
    (tagName === "img" || tagName === "source")
  ) {
    return true
  }

  if (
    (attributeName === "href" || attributeName === "xlink:href") &&
    (tagName === "image" || tagName === "use")
  ) {
    return true
  }

  return false
}

function resolveDomStyleSheetText(
  sectionHref: string,
  value: string,
  resolveDomResourceUrl: (path: string) => string
): string {
  return resolveDomCssUrlValues(sectionHref, value, resolveDomResourceUrl)
}

function resolveDomCssUrlValues(
  sectionHref: string,
  value: string,
  resolveDomResourceUrl: (path: string) => string
): string {
  return value.replace(
    /url\(\s*(['"]?)([^)"']+)\1\s*\)/gi,
    (match, quote: string, path: string) => {
      if (!path || isExternalResourceValue(path)) {
        return match
      }

      const resolved = resolveDomResourceUrl(resolveResourcePath(sectionHref, path))
      const wrappedQuote = quote || '"'
      return `url(${wrappedQuote}${resolved}${wrappedQuote})`
    }
  )
}

function isExternalResourceValue(value: string): boolean {
  return (
    value.startsWith("data:") ||
    value.startsWith("blob:") ||
    value.startsWith("//") ||
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)
  )
}

function resolvePresentationSectionImage(
  book: Book | null,
  section: SectionDocument
): { src: string; alt?: string } | null {
  if (section.presentationRole === "cover") {
    const coverImageHref = book?.metadata.coverImageHref
    if (coverImageHref) {
      return {
        src: coverImageHref,
        ...(book?.metadata.title ? { alt: book.metadata.title } : {})
      }
    }
  }

  if (section.presentationRole === "cover" || section.presentationRole === "image-page") {
    return extractSingleSectionImage(section)
  }

  return null
}

function extractSingleSectionImage(
  section: SectionDocument
): { src: string; alt?: string } | null {
  if (section.blocks.length !== 1) {
    return null
  }

  const [block] = section.blocks
  if (!block) {
    return null
  }

  if (block.kind === "image") {
    return {
      src: block.src,
      ...(block.alt ? { alt: block.alt } : {})
    }
  }

  if (
    block.kind === "text" &&
    block.inlines.length === 1 &&
    block.inlines[0]?.kind === "image"
  ) {
    const image = block.inlines[0]
    return {
      src: image.src,
      ...(image.alt ? { alt: image.alt } : {})
    }
  }

  return null
}
