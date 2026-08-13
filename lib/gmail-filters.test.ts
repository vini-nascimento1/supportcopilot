import { describe, it, expect } from "vitest"

import { GMAIL_FILTERS, getFilterQuery } from "./gmail-filters"

describe("GMAIL_FILTERS", () => {
  it("defines the six expected filters with their label/query pairs", () => {
    expect(GMAIL_FILTERS.primary).toEqual({ label: "Primary", query: "in:inbox category:primary" })
    expect(GMAIL_FILTERS.all).toEqual({ label: "All mail", query: "in:inbox" })
    expect(GMAIL_FILTERS.unread).toEqual({ label: "Unread", query: "is:unread in:inbox" })
    expect(GMAIL_FILTERS.starred).toEqual({ label: "Starred", query: "is:starred in:inbox" })
    expect(GMAIL_FILTERS.spam).toEqual({ label: "Spam", query: "in:spam" })
    expect(GMAIL_FILTERS.trash).toEqual({ label: "Trash", query: "in:trash" })
  })
})

describe("getFilterQuery", () => {
  it("returns the matching query for each valid key", () => {
    expect(getFilterQuery("primary")).toBe("in:inbox category:primary")
    expect(getFilterQuery("all")).toBe("in:inbox")
    expect(getFilterQuery("unread")).toBe("is:unread in:inbox")
    expect(getFilterQuery("starred")).toBe("is:starred in:inbox")
    expect(getFilterQuery("spam")).toBe("in:spam")
    expect(getFilterQuery("trash")).toBe("in:trash")
  })

  it("falls back to primary's query for an unknown key", () => {
    expect(getFilterQuery("bogus")).toBe(GMAIL_FILTERS.primary.query)
    expect(getFilterQuery("")).toBe(GMAIL_FILTERS.primary.query)
  })
})
