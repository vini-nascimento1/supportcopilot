import { describe, it, expect } from "vitest"

import { MAX_DISMISS_IDS, isValidItemId, parseItemIds } from "./dismissals"

// The dismiss route is a thin shell over parseItemIds, so this is where the
// input rules for POST/DELETE /api/briefing/dismiss are pinned down.

describe("isValidItemId", () => {
  it("accepts the ids the sources actually mint", () => {
    expect(isValidItemId("intercom:12345")).toBe(true)
    expect(isValidItemId("slack:C0ABC:1788000000.000100")).toBe(true)
    expect(isValidItemId("gmail:18f0c")).toBe(true)
    expect(isValidItemId("calendar:evt_1")).toBe(true)
  })

  it("rejects anything without a known prefix, and anything oversized", () => {
    expect(isValidItemId("")).toBe(false)
    expect(isValidItemId("intercom")).toBe(false)
    expect(isValidItemId("fadmin:1")).toBe(false)
    expect(isValidItemId(42)).toBe(false)
    expect(isValidItemId(`intercom:${"x".repeat(300)}`)).toBe(false)
  })
})

describe("parseItemIds", () => {
  it("deduplicates a valid batch", () => {
    const parsed = parseItemIds({ ids: ["intercom:1", "intercom:1", "gmail:2"] })
    expect(parsed).toEqual({ ok: true, ids: ["intercom:1", "gmail:2"] })
  })

  it("refuses a missing, empty or oversized array", () => {
    expect(parseItemIds({}).ok).toBe(false)
    expect(parseItemIds({ ids: "intercom:1" }).ok).toBe(false)
    expect(parseItemIds({ ids: [] }).ok).toBe(false)
    expect(parseItemIds({ ids: Array(MAX_DISMISS_IDS + 1).fill("intercom:1") }).ok).toBe(false)
  })

  it("refuses a batch where any single id is invalid", () => {
    expect(parseItemIds({ ids: ["intercom:1", "drop table"] }).ok).toBe(false)
  })
})
