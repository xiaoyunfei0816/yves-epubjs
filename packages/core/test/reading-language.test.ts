import { describe, expect, it } from "vitest"
import type { Book, SectionDocument } from "../src/model/types"
import {
  inferReadingDirectionFromLanguage,
  resolveReadingLanguageContext,
  resolveReadingNavigationContext
} from "../src/runtime/reading-language"

describe("reading language helpers", () => {
  it("infers rtl and ltr directions from language tags", () => {
    expect(inferReadingDirectionFromLanguage("ar")).toBe("rtl")
    expect(inferReadingDirectionFromLanguage("fa-IR")).toBe("rtl")
    expect(inferReadingDirectionFromLanguage("en-US")).toBe("ltr")
    expect(inferReadingDirectionFromLanguage(undefined)).toBeUndefined()
  })

  it("resolves section language context with experimental rtl activation", () => {
    const section: SectionDocument = {
      id: "section-1",
      href: "OPS/chapter.xhtml",
      lang: "ar",
      blocks: [],
      anchors: {}
    }
    const book: Book = {
      metadata: {
        title: "Arabic Reader",
        language: "en"
      },
      manifest: [],
      spine: [],
      toc: [],
      sections: [section]
    }

    expect(
      resolveReadingLanguageContext({
        book,
        section,
        spineIndex: 0,
        experimentalRtl: false
      })
    ).toEqual({
      spineIndex: 0,
      sectionId: "section-1",
      sectionHref: "OPS/chapter.xhtml",
      bookLanguage: "en",
      sectionLanguage: "ar",
      resolvedLanguage: "ar",
      contentDirection: "rtl",
      rtlSuggested: true,
      rtlActive: false
    })
    expect(
      resolveReadingLanguageContext({
        book,
        section,
        spineIndex: 0,
        experimentalRtl: true
      }).rtlActive
    ).toBe(true)
  })

  it("derives page progression and arrow-key mapping from active rtl state", () => {
    const rtlNavigation = resolveReadingNavigationContext({
      languageContext: {
        spineIndex: 0,
        sectionId: "section-rtl",
        sectionHref: "OPS/rtl.xhtml",
        contentDirection: "rtl",
        rtlSuggested: true,
        rtlActive: true
      }
    })
    const ltrNavigation = resolveReadingNavigationContext({
      languageContext: {
        spineIndex: 0,
        sectionId: "section-ltr",
        sectionHref: "OPS/ltr.xhtml",
        contentDirection: "rtl",
        rtlSuggested: true,
        rtlActive: false
      }
    })

    expect(rtlNavigation).toEqual({
      spineIndex: 0,
      sectionId: "section-rtl",
      sectionHref: "OPS/rtl.xhtml",
      contentDirection: "rtl",
      pageProgression: "rtl",
      rtlActive: true,
      previousPageKey: "ArrowRight",
      nextPageKey: "ArrowLeft"
    })
    expect(ltrNavigation.pageProgression).toBe("ltr")
    expect(ltrNavigation.previousPageKey).toBe("ArrowLeft")
    expect(ltrNavigation.nextPageKey).toBe("ArrowRight")
  })
})
