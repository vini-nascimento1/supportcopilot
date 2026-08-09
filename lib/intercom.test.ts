import { describe, expect, it } from "vitest"

import { classifyIntercomAuthor, extractArticleKeywords } from "./intercom"

// The previous searchArticles passed the WHOLE ticket text as a single Intercom
// `~` (contains) needle, so it asked whether an article body literally contains
// a full customer paragraph. It essentially never matched, silently emptying
// the layer the draft prompt calls "your factual source of truth".
describe("extractArticleKeywords", () => {
  it("reduces a real ticket to searchable keywords", () => {
    const keywords = extractArticleKeywords(
      "Hello, I have a problem with my payout. It has been pending for 6 days and I cannot withdraw."
    )
    expect(keywords).toContain("payout")
    expect(keywords).toContain("pending")
    expect(keywords).not.toContain("hello")
    expect(keywords).not.toContain("problem")
  })

  it("puts identifier-shaped tokens first — they are the highest-signal thing in a ticket", () => {
    const keywords = extractArticleKeywords("I need help with my w-8ben tax form submission")
    expect(keywords[0]).toBe("w-8ben")
  })

  it("keeps codes and statuses that prose filtering would drop", () => {
    const keywords = extractArticleKeywords("My account shows SYS_CB911 and the 3ds check failed")
    expect(keywords).toContain("sys_cb911")
    expect(keywords).toContain("3ds")
  })

  it("caps the keyword count so the query stays bounded", () => {
    const long = Array.from({ length: 50 }, (_, i) => `distinctword${i}`).join(" ")
    expect(extractArticleKeywords(long).length).toBeLessThanOrEqual(6)
  })

  it("deduplicates repeated words", () => {
    const keywords = extractArticleKeywords("payout payout payout refund")
    expect(keywords.filter((k) => k === "payout")).toHaveLength(1)
  })

  it("strips html rather than indexing markup", () => {
    const keywords = extractArticleKeywords("<p>my <b>payout</b> is pending</p>")
    expect(keywords).toContain("payout")
    expect(keywords).not.toContain("p")
    expect(keywords).not.toContain("b")
  })

  it("returns nothing for a message with no substantive content", () => {
    expect(extractArticleKeywords("hi there, thanks!")).toEqual([])
  })
})

describe("classifyIntercomAuthor", () => {
  it("treats customers as customer-authored", () => {
    expect(classifyIntercomAuthor({ type: "user" })).toBe("customer")
    expect(classifyIntercomAuthor({ type: "lead" })).toBe("customer")
    expect(classifyIntercomAuthor({ type: "contact" })).toBe("customer")
  })

  it("treats admins and teams as agent-authored", () => {
    expect(classifyIntercomAuthor({ type: "admin" })).toBe("admin")
    expect(classifyIntercomAuthor({ type: "team" })).toBe("admin")
  })

  it("treats Fin and Intercom bots as AI helper-authored", () => {
    expect(classifyIntercomAuthor({ type: "bot" })).toBe("ai")
    expect(classifyIntercomAuthor({ type: "admin", name: "Fin" })).toBe("ai")
    expect(
      classifyIntercomAuthor({ type: "admin", name: "Fin AI Agent" })
    ).toBe("ai")
  })
})
