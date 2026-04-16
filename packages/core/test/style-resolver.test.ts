import { describe, expect, it } from "vitest"
import { parseCssStyleSheet } from "../src/parser/css-ast-adapter"
import { parseHtmlDocument } from "../src/parser/html-dom-adapter"
import { selectFirstHtmlElement } from "../src/parser/selector-matcher"
import {
  parseInlineStyleAttribute,
  resolveElementStyle,
  resolveElementTextStyle
} from "../src/parser/style-resolver"

describe("style resolver", () => {
  it("parses inline style attributes into declaration entries", () => {
    expect(
      parseInlineStyleAttribute("font-size: 18px; color: #333; invalid")
    ).toEqual([
      { property: "font-size", value: "18px" },
      { property: "color", value: "#333" }
    ])
  })

  it("merges default style, matched rules, and inline style in order", () => {
    const document = parseHtmlDocument(`
      <html>
        <body>
          <p class="lead" style="font-size: 18px; color: #444;">Hello</p>
        </body>
      </html>
    `)
    const paragraph = selectFirstHtmlElement("p", document)
    expect(paragraph).toBeTruthy()

    const stylesheet = parseCssStyleSheet(`
      p { color: #111; text-align: left; margin-top: 12px; }
      .lead { font-weight: 700; color: #222; }
    `)

    const resolved = paragraph
      ? resolveElementStyle({
          element: paragraph,
          stylesheets: [stylesheet],
          defaultStyle: {
            fontSize: 16,
            color: "#000",
            lineHeight: 1.6
          }
        })
      : {}

    expect(resolved).toEqual({
      fontSize: 18,
      color: "#444",
      lineHeight: 1.6,
      textAlign: "start",
      marginTop: 12,
      fontWeight: "700"
    })
  })

  it("ignores non-whitelisted declarations and exposes text style view", () => {
    const document = parseHtmlDocument(`
      <html>
        <body>
          <span class="lead">Hello</span>
        </body>
      </html>
    `)
    const span = selectFirstHtmlElement("span", document)
    expect(span).toBeTruthy()

    const stylesheet = parseCssStyleSheet(`
      span.lead {
        color: #333;
        position: absolute;
        font-style: italic;
      }
    `)

    const resolved = span
      ? resolveElementTextStyle({
          element: span,
          stylesheets: [stylesheet]
        })
      : {}

    expect(resolved).toEqual({
      color: "#333",
      fontStyle: "italic"
    })
  })

  it("keeps supported spacing declarations while ignoring unsupported values", () => {
    const document = parseHtmlDocument(`
      <html>
        <body>
          <div style="padding-top: 12px; padding-left: 8px; padding-right: auto; margin-bottom: 10px; inset: 0;">
            Hello
          </div>
        </body>
      </html>
    `)
    const block = selectFirstHtmlElement("div", document)
    expect(block).toBeTruthy()

    const resolved = block
      ? resolveElementStyle({
          element: block
        })
      : {}

    expect(resolved).toEqual({
      paddingTop: 12,
      paddingLeft: 8,
      marginBottom: 10
    })
  })

  it("maps legacy presentational attributes into supported block and text styles", () => {
    const document = parseHtmlDocument(`
      <html>
        <body>
          <p align="center"><font size="2" color="#663300" face="KaiTi">Hello</font></p>
        </body>
      </html>
    `)
    const paragraph = selectFirstHtmlElement("p", document)
    const font = selectFirstHtmlElement("font", document)

    expect(paragraph).toBeTruthy()
    expect(font).toBeTruthy()

    expect(
      paragraph
        ? resolveElementStyle({
            element: paragraph
          })
        : {}
    ).toEqual({
      textAlign: "center"
    })

    expect(
      font
        ? resolveElementTextStyle({
            element: font
          })
        : {}
    ).toEqual({
      fontSize: 13,
      color: "#663300",
      fontFamily: "KaiTi"
    })
  })
})
