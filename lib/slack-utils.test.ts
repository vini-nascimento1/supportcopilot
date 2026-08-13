import { describe, it, expect } from "vitest"

import { parseSlackEmojis, getMessagePermalink } from "./slack-utils"
import type { EmojiMap } from "./slack-utils"

describe("parseSlackEmojis (fallback map only, no dynamicMap)", () => {
  it("replaces a known shortcode with its unicode character", () => {
    expect(parseSlackEmojis("hello :smile: world")).toBe("hello 😄 world")
  })

  it("replaces multiple shortcodes in the same string", () => {
    expect(parseSlackEmojis(":fire: and :rocket:")).toBe("🔥 and 🚀")
  })

  it("handles shortcodes with + and - characters", () => {
    expect(parseSlackEmojis(":+1: :-1:")).toBe("👍 👎")
  })

  it("matches shortcode names case-insensitively", () => {
    expect(parseSlackEmojis(":SMILE:")).toBe("😄")
  })

  it("leaves an unknown shortcode untouched", () => {
    expect(parseSlackEmojis("test :not_a_real_emoji: end")).toBe("test :not_a_real_emoji: end")
  })

  it("leaves text with no shortcodes untouched", () => {
    expect(parseSlackEmojis("nothing to see here")).toBe("nothing to see here")
  })

  it("returns an empty string unchanged", () => {
    expect(parseSlackEmojis("")).toBe("")
  })

  it("does not match a lone colon or an unterminated shortcode", () => {
    expect(parseSlackEmojis("price: $5, ratio: 2:1")).toBe("price: $5, ratio: 2:1")
    expect(parseSlackEmojis(":smile without a closing colon")).toBe(
      ":smile without a closing colon"
    )
  })

  it("does not match an empty shortcode (::)", () => {
    expect(parseSlackEmojis("a::b")).toBe("a::b")
  })
})

describe("parseSlackEmojis (with dynamicMap)", () => {
  it("resolves a custom emoji URL to an img tag", () => {
    const map: EmojiMap = { partyparrot: "https://emoji.example.com/partyparrot.gif" }
    expect(parseSlackEmojis("go :partyparrot:", map)).toBe(
      'go <img src="https://emoji.example.com/partyparrot.gif" alt=":partyparrot:" class="inline-block size-4 align-middle rounded-sm" />'
    )
  })

  it("preserves the originally-typed casing in the alt text", () => {
    const map: EmojiMap = { partyparrot: "https://emoji.example.com/partyparrot.gif" }
    expect(parseSlackEmojis(":PartyParrot:", map)).toBe(
      '<img src="https://emoji.example.com/partyparrot.gif" alt=":PartyParrot:" class="inline-block size-4 align-middle rounded-sm" />'
    )
  })

  it("dynamic entries override the fallback map for the same key", () => {
    const map: EmojiMap = { smile: "🥸" }
    expect(parseSlackEmojis(":smile:", map)).toBe("🥸")
  })

  it("still resolves fallback-only shortcodes when a dynamicMap is provided", () => {
    const map: EmojiMap = { partyparrot: "https://emoji.example.com/partyparrot.gif" }
    expect(parseSlackEmojis(":fire:", map)).toBe("🔥")
  })

  it("leaves unknown shortcodes untouched when merged map has no entry either", () => {
    const map: EmojiMap = { partyparrot: "https://emoji.example.com/partyparrot.gif" }
    expect(parseSlackEmojis(":totally_made_up:", map)).toBe(":totally_made_up:")
  })

  it("treats an empty dynamicMap the same as the fallback-only path", () => {
    expect(parseSlackEmojis(":smile:", {})).toBe("😄")
  })
})

describe("getMessagePermalink", () => {
  it("builds a permalink and strips the dot from the timestamp", () => {
    expect(getMessagePermalink("https://fanvue.slack.com", "C123", "1626892800.123456")).toBe(
      "https://fanvue.slack.com/archives/C123/p1626892800123456"
    )
  })

  it("leaves a timestamp with no dot unchanged", () => {
    expect(getMessagePermalink("https://fanvue.slack.com", "C123", "1626892800")).toBe(
      "https://fanvue.slack.com/archives/C123/p1626892800"
    )
  })

  it("only strips the first dot when the timestamp has more than one", () => {
    // String#replace with a non-global pattern only removes the first match
    expect(getMessagePermalink("https://fanvue.slack.com", "C123", "1.2.3")).toBe(
      "https://fanvue.slack.com/archives/C123/p12.3"
    )
  })

  it("concatenates literally without normalizing a trailing slash on the workspace URL", () => {
    expect(getMessagePermalink("https://fanvue.slack.com/", "C123", "1626892800.123456")).toBe(
      "https://fanvue.slack.com//archives/C123/p1626892800123456"
    )
  })

  it("handles empty strings for all arguments", () => {
    expect(getMessagePermalink("", "", "")).toBe("/archives//p")
  })
})
