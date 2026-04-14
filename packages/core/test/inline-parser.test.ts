import { describe, expect, it } from "vitest";
import { parseInlineContent } from "../src/parser/inline-parser";

describe("parseInlineContent", () => {
  it("parses emphasis, strong, links, code, images, and line breaks", () => {
    const source = {
      "#text": "Alice ",
      strong: { "#text": "saw" },
      em: { "#text": " a " },
      a: {
        "@_href": "notes.xhtml#n1",
        "#text": "note"
      },
      br: "",
      code: { "#text": "print('alice')" },
      img: {
        "@_src": "../images/inline.png",
        "@_alt": "Inline"
      }
    };

    expect(parseInlineContent(source, "OPS/text/chapter.xhtml")).toEqual([
      { kind: "text", text: "Alice " },
      { kind: "strong", children: [{ kind: "text", text: "saw" }] },
      { kind: "emphasis", children: [{ kind: "text", text: " a " }] },
      {
        kind: "link",
        href: "OPS/text/notes.xhtml#n1",
        children: [{ kind: "text", text: "note" }]
      },
      { kind: "line-break" },
      { kind: "code", text: "print('alice')" },
      {
        kind: "image",
        src: "OPS/images/inline.png",
        alt: "Inline"
      }
    ]);
  });
});
