import {
  findHtmlElementsByTagName,
  getHtmlElementAttribute,
  getHtmlNodeTextContent,
  parseHtmlDocument,
  type HtmlDomDocument,
  type HtmlDomElement
} from "./html-dom-adapter"

export type XhtmlDomDocument = {
  document: HtmlDomDocument
  htmlElement: HtmlDomElement | null
  headElement: HtmlDomElement | null
  bodyElement: HtmlDomElement | null
  title?: string
  lang?: string
}

export function parseXhtmlDomDocument(xml: string): XhtmlDomDocument {
  const document = parseHtmlDocument(xml, {
    xmlMode: true
  })
  const htmlElement = findHtmlElementsByTagName(document, "html")[0] ?? null
  const headElement = findHtmlElementsByTagName(document, "head")[0] ?? null
  const bodyElement = findHtmlElementsByTagName(document, "body")[0] ?? null
  const titleElement = headElement
    ? findHtmlElementsByTagName(headElement, "title")[0] ?? null
    : null

  const title = titleElement
    ? getHtmlNodeTextContent(titleElement).replace(/\s+/g, " ").trim() || undefined
    : undefined
  const lang = htmlElement
    ? getHtmlElementAttribute(htmlElement, "xml:lang") ??
      getHtmlElementAttribute(htmlElement, "lang")
    : undefined

  return {
    document,
    htmlElement,
    headElement,
    bodyElement,
    ...(title ? { title } : {}),
    ...(lang ? { lang } : {})
  }
}
