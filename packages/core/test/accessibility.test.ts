import { describe, expect, it } from "vitest"
import type { SectionDocument } from "../src/model/types"
import { buildSectionAccessibilitySnapshot } from "../src/runtime/accessibility"

describe("accessibility snapshot helpers", () => {
  it("exports semantic reading entries for alt text, captions, aside content, and definition lists", () => {
    const section: SectionDocument = {
      id: "section-1",
      href: "OPS/chapter.xhtml",
      anchors: {},
      blocks: [
        {
          id: "image-1",
          kind: "image",
          src: "images/cover.jpg",
          alt: "Cover illustration"
        },
        {
          id: "figure-1",
          kind: "figure",
          blocks: [
            {
              id: "image-2",
              kind: "image",
              src: "images/diagram.jpg",
              alt: "Diagram alt text"
            }
          ],
          caption: [
            {
              id: "caption-1",
              kind: "text",
              inlines: [{ kind: "text", text: "Figure caption text" }]
            }
          ]
        },
        {
          id: "table-1",
          kind: "table",
          caption: [
            {
              id: "table-caption-1",
              kind: "text",
              inlines: [{ kind: "text", text: "Table caption text" }]
            }
          ],
          rows: [
            {
              id: "row-1",
              cells: [
                {
                  id: "cell-1",
                  blocks: [
                    {
                      id: "cell-text-1",
                      kind: "text",
                      inlines: [{ kind: "text", text: "Table cell body" }]
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          id: "aside-1",
          kind: "aside",
          blocks: [
            {
              id: "footnote-1",
              kind: "text",
              inlines: [{ kind: "text", text: "Footnote aside content" }]
            }
          ]
        },
        {
          id: "defs-1",
          kind: "definition-list",
          items: [
            {
              id: "def-item-1",
              term: [
                {
                  id: "term-1",
                  kind: "text",
                  inlines: [{ kind: "text", text: "Term A" }]
                }
              ],
              descriptions: [
                [
                  {
                    id: "desc-1",
                    kind: "text",
                    inlines: [{ kind: "text", text: "Definition A" }]
                  }
                ]
              ]
            }
          ]
        }
      ]
    }

    const snapshot = buildSectionAccessibilitySnapshot({
      section,
      spineIndex: 0
    })

    expect(snapshot.text).toContain("Cover illustration")
    expect(snapshot.text).toContain("Figure caption text")
    expect(snapshot.text).toContain("Table caption text")
    expect(snapshot.text).toContain("Footnote aside content")
    expect(snapshot.text).toContain("Term A")
    expect(snapshot.text).toContain("Definition A")

    expect(snapshot.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "image",
          blockId: "image-1",
          text: "Cover illustration",
          altText: "Cover illustration"
        }),
        expect.objectContaining({
          kind: "figure-caption",
          blockId: "caption-1",
          text: "Figure caption text",
          containerPath: ["figure"]
        }),
        expect.objectContaining({
          kind: "table-caption",
          blockId: "table-caption-1",
          text: "Table caption text",
          containerPath: ["table"]
        }),
        expect.objectContaining({
          blockId: "cell-text-1",
          text: "Table cell body",
          containerPath: ["table"]
        }),
        expect.objectContaining({
          blockId: "footnote-1",
          text: "Footnote aside content",
          containerPath: ["aside"]
        }),
        expect.objectContaining({
          kind: "definition-term",
          blockId: "term-1",
          text: "Term A",
          containerPath: ["definition-list"]
        }),
        expect.objectContaining({
          kind: "definition-description",
          blockId: "desc-1",
          text: "Definition A",
          containerPath: ["definition-list"]
        })
      ])
    )

    expect(snapshot.diagnostics).toEqual({
      totalEntries: 8,
      imageEntries: 2,
      imageAltEntries: 2,
      imageMissingAltEntries: 0,
      figureCaptionEntries: 1,
      tableCaptionEntries: 1,
      asideEntries: 1,
      definitionTermEntries: 1,
      definitionDescriptionEntries: 1
    })
  })
})
