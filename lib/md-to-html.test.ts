import { describe, it, expect } from "vitest"

import { mdToHtml } from "./md-to-html"

describe("mdToHtml", () => {
  it("wraps a plain paragraph in <p>", () => {
    expect(mdToHtml("Hello there")).toBe("<p>Hello there</p>")
  })

  it("converts **bold**", () => {
    expect(mdToHtml("**bold text**")).toBe("<p><strong>bold text</strong></p>")
  })

  it("converts *italic*", () => {
    expect(mdToHtml("*italic text*")).toBe("<p><em>italic text</em></p>")
  })

  it("converts _italic_ (underscore form)", () => {
    expect(mdToHtml("_italic text_")).toBe("<p><em>italic text</em></p>")
  })

  it("processes bold before italic so ** isn't mistaken for two *", () => {
    expect(mdToHtml("**bold** and *italic*")).toBe("<p><strong>bold</strong> and <em>italic</em></p>")
  })

  it("converts a [text](url) link", () => {
    expect(mdToHtml("[Fanvue](https://fanvue.com)")).toBe('<p><a href="https://fanvue.com">Fanvue</a></p>')
  })

  it("escapes HTML-unsafe characters in a plain paragraph", () => {
    expect(mdToHtml("Tom & Jerry < 3 > 2")).toBe("<p>Tom &amp; Jerry &lt; 3 &gt; 2</p>")
  })

  it("escapes HTML-unsafe characters inside a bold span", () => {
    expect(mdToHtml("**A & B**")).toBe("<p><strong>A &amp; B</strong></p>")
  })

  it("escapes HTML-unsafe characters inside a link's text and url", () => {
    expect(mdToHtml("[A&B](https://x.test?a=1&b=2)")).toBe(
      '<p><a href="https://x.test?a=1&amp;b=2">A&amp;B</a></p>'
    )
  })

  it("converts a bullet list", () => {
    expect(mdToHtml("- One\n- Two")).toBe("<ul>\n<li>One</li>\n<li>Two</li>\n</ul>")
  })

  it("converts a numbered list", () => {
    expect(mdToHtml("1. One\n2. Two")).toBe("<ol>\n<li>One</li>\n<li>Two</li>\n</ol>")
  })

  it("closes a bullet list before opening a numbered list with no blank line between them", () => {
    expect(mdToHtml("- One\n1. Two")).toBe("<ul>\n<li>One</li>\n</ul>\n<ol>\n<li>Two</li>\n</ol>")
  })

  it("closes a numbered list before opening a bullet list with no blank line between them", () => {
    expect(mdToHtml("1. One\n- Two")).toBe("<ol>\n<li>One</li>\n</ol>\n<ul>\n<li>Two</li>\n</ul>")
  })

  it("closes a list left open at the end of the input", () => {
    const out = mdToHtml("- One\n- Two")
    expect(out.endsWith("</ul>")).toBe(true)
    expect(out.split("</ul>")).toHaveLength(2) // exactly one closing tag, not left dangling
  })

  it("handles mixed content: paragraph, list, paragraph", () => {
    expect(mdToHtml("Intro\n- item one\n- item two\nOutro")).toBe(
      "<p>Intro</p>\n<ul>\n<li>item one</li>\n<li>item two</li>\n</ul>\n<p>Outro</p>"
    )
  })
})
