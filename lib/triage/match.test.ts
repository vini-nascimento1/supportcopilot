import { describe, it, expect } from "vitest"

import {
  normalizeTriagePrefs,
  normalizeForMatch,
  matchesKeywords,
  matchesAudience,
  urgencyScore,
  filterAndRank,
  EMPTY_TRIAGE_PREFS,
  type TriageItem,
  type TriagePrefs,
} from "./match"

function makeItem(overrides: Partial<TriageItem> = {}): TriageItem {
  return {
    conversationId: "1",
    subject: "Payout question",
    customerName: "Jane",
    snippet: "I cannot withdraw my earnings",
    tags: [],
    priority: false,
    slaStatus: null,
    waitingSince: null,
    conversationCreatedAt: null,
    matchedPlaybookId: null,
    matchedPlaybookName: null,
    matchScore: null,
    capabilityGap: false,
    ...overrides,
  }
}

function makePrefs(overrides: Partial<TriagePrefs> = {}): TriagePrefs {
  return { ...EMPTY_TRIAGE_PREFS, ...overrides }
}

describe("normalizeForMatch", () => {
  it("lowercases and strips accents (NFD + combining-mark strip)", () => {
    expect(normalizeForMatch("SAQUÉ")).toBe("saque")
    expect(normalizeForMatch("saque")).toBe("saque")
    expect(normalizeForMatch("café não")).toBe("cafe nao")
  })
})

describe("matchesKeywords", () => {
  it("is accent-insensitive: 'saque' matches a snippet containing 'saqué'", () => {
    const item = makeItem({ snippet: "Não consigo fazer o saqué do meu dinheiro" })
    expect(matchesKeywords(item, ["saque"])).toEqual(["saque"])
  })

  it("matches across subject + snippet + tags, substring, case-insensitive", () => {
    const item = makeItem({ subject: "KYC stuck", snippet: "verification pending", tags: ["URGENT_TAG"] })
    expect(matchesKeywords(item, ["kyc"])).toEqual(["kyc"])
    expect(matchesKeywords(item, ["pending"])).toEqual(["pending"])
    expect(matchesKeywords(item, ["urgent"])).toEqual(["urgent"])
  })

  it("empty terms means match-all: returns [] rather than 'no hits'", () => {
    const item = makeItem()
    expect(matchesKeywords(item, [])).toEqual([])
  })

  it("returns only the terms that actually hit, not all supplied terms", () => {
    const item = makeItem({ subject: "Payout delay", snippet: "still waiting" })
    expect(matchesKeywords(item, ["payout", "banana"])).toEqual(["payout"])
  })
})

describe("matchesAudience", () => {
  it("matches the real CREATOR_TAG vocabulary via substring-on-normalized", () => {
    expect(matchesAudience(["CREATOR_TAG"], ["creator"])).toBe(true)
    expect(matchesAudience(["FAN_TAG"], ["creator"])).toBe(false)
    expect(matchesAudience(["AGENCY_TAG"], ["agency"])).toBe(true)
  })

  it("no audiences selected means no filter (always true)", () => {
    expect(matchesAudience([], [])).toBe(true)
    expect(matchesAudience(null, [])).toBe(true)
    expect(matchesAudience(undefined, [])).toBe(true)
  })

  it("is false when tags are empty/missing but an audience filter is active", () => {
    expect(matchesAudience([], ["creator"])).toBe(false)
    expect(matchesAudience(null, ["creator"])).toBe(false)
  })

  it("matches if ANY selected audience hits ANY tag", () => {
    expect(matchesAudience(["FAN_TAG"], ["creator", "fan"])).toBe(true)
  })
})

describe("urgencyScore", () => {
  const now = Date.parse("2026-07-18T12:00:00Z")

  it("missed SLA scores higher than active", () => {
    const missed = urgencyScore(makeItem({ slaStatus: "missed" }), now)
    const active = urgencyScore(makeItem({ slaStatus: "active" }), now)
    expect(missed).toBeGreaterThan(active)
    expect(missed).toBe(3)
    expect(active).toBe(2)
  })

  it("priority flag adds a flat +2", () => {
    expect(urgencyScore(makeItem({ priority: true }), now)).toBe(2)
    expect(urgencyScore(makeItem({ priority: false }), now)).toBe(0)
  })

  it("null waitingSince contributes 0", () => {
    expect(urgencyScore(makeItem({ waitingSince: null }), now)).toBe(0)
  })

  it("waiting time scales 0..2 and caps at 240 minutes", () => {
    const at60min = urgencyScore(
      makeItem({ waitingSince: new Date(now - 60 * 60_000).toISOString() }),
      now
    )
    const at240min = urgencyScore(
      makeItem({ waitingSince: new Date(now - 240 * 60_000).toISOString() }),
      now
    )
    const at480min = urgencyScore(
      makeItem({ waitingSince: new Date(now - 480 * 60_000).toISOString() }),
      now
    )
    expect(at60min).toBeCloseTo(0.5, 5)
    expect(at240min).toBeCloseTo(2, 5)
    expect(at480min).toBeCloseTo(2, 5) // capped, not double
  })
})

describe("filterAndRank", () => {
  const now = Date.parse("2026-07-18T12:00:00Z")

  it("priorityOnly drops non-priority items", () => {
    const items = [makeItem({ conversationId: "a", priority: true }), makeItem({ conversationId: "b", priority: false })]
    const ranked = filterAndRank(items, makePrefs({ priorityOnly: true }), now)
    expect(ranked.map((r) => r.item.conversationId)).toEqual(["a"])
  })

  it("empty prefs (no keywords/audiences/priorityOnly) matches everything", () => {
    const items = [makeItem({ conversationId: "a" }), makeItem({ conversationId: "b" })]
    const ranked = filterAndRank(items, EMPTY_TRIAGE_PREFS, now)
    expect(ranked).toHaveLength(2)
  })

  it("expandedTerms are only applied when expand is true", () => {
    const items = [makeItem({ conversationId: "a", subject: "refund request" })]

    const withoutExpand = filterAndRank(
      items,
      makePrefs({ keywords: ["payout"], expand: false, expandedTerms: ["refund"] }),
      now
    )
    expect(withoutExpand).toHaveLength(0) // "refund" ignored, "payout" doesn't hit

    const withExpand = filterAndRank(
      items,
      makePrefs({ keywords: ["payout"], expand: true, expandedTerms: ["refund"] }),
      now
    )
    expect(withExpand).toHaveLength(1) // "refund" now in play and hits
    expect(withExpand[0].matchedTerms).toEqual(["refund"])
  })

  it("sorts missed-SLA and longer waits first (urgency desc, then waitingSince asc)", () => {
    const items = [
      makeItem({ conversationId: "low", slaStatus: null, waitingSince: null }),
      makeItem({
        conversationId: "missed-recent",
        slaStatus: "missed",
        waitingSince: new Date(now - 10 * 60_000).toISOString(),
      }),
      makeItem({
        conversationId: "missed-older",
        slaStatus: "missed",
        waitingSince: new Date(now - 120 * 60_000).toISOString(),
      }),
    ]
    const ranked = filterAndRank(items, EMPTY_TRIAGE_PREFS, now)
    // Both "missed" items outrank "low" (urgency 3+ vs 0); the older wait
    // breaks the tie between the two missed items since both get the same
    // +3 SLA component but the older one has picked up more waiting-time score.
    expect(ranked.map((r) => r.item.conversationId)).toEqual(["missed-older", "missed-recent", "low"])
  })

  it("puts null waitingSince last when urgency actually ties", () => {
    // Both land on urgency 2: "no-wait" via the priority flag, "capped-wait"
    // via a wait so long it's already saturated the 240-min cap. A real tie,
    // so this exercises the waitingSince asc/nulls-last tiebreak itself.
    const items = [
      makeItem({ conversationId: "no-wait", priority: true, waitingSince: null }),
      makeItem({
        conversationId: "capped-wait",
        priority: false,
        waitingSince: new Date(now - 500 * 60_000).toISOString(),
      }),
    ]
    const ranked = filterAndRank(items, EMPTY_TRIAGE_PREFS, now)
    expect(ranked.map((r) => r.urgency)).toEqual([2, 2])
    expect(ranked.map((r) => r.item.conversationId)).toEqual(["capped-wait", "no-wait"])
  })

  it("breaks remaining ties with conversationCreatedAt ascending (oldest first)", () => {
    const items = [
      makeItem({ conversationId: "newer", conversationCreatedAt: "2026-07-18T10:00:00Z" }),
      makeItem({ conversationId: "older", conversationCreatedAt: "2026-07-17T10:00:00Z" }),
    ]
    const ranked = filterAndRank(items, EMPTY_TRIAGE_PREFS, now)
    expect(ranked.map((r) => r.item.conversationId)).toEqual(["older", "newer"])
  })
})

describe("normalizeTriagePrefs", () => {
  it("returns EMPTY_TRIAGE_PREFS for null/non-object garbage", () => {
    expect(normalizeTriagePrefs(null)).toEqual(EMPTY_TRIAGE_PREFS)
    expect(normalizeTriagePrefs(undefined)).toEqual(EMPTY_TRIAGE_PREFS)
    expect(normalizeTriagePrefs("garbage")).toEqual(EMPTY_TRIAGE_PREFS)
    expect(normalizeTriagePrefs(42)).toEqual(EMPTY_TRIAGE_PREFS)
    expect(normalizeTriagePrefs([])).toEqual(EMPTY_TRIAGE_PREFS)
  })

  it("drops non-string array entries, trims/lowercases, drops empties", () => {
    const prefs = normalizeTriagePrefs({
      keywords: ["  Payout ", 42, null, "", "KYC"],
      expand: true,
      expandedTerms: ["refund", 7],
      expandedFor: "payout,kyc",
      audiences: ["Creator", "bogus", "fan"],
      priorityOnly: "yes", // not a real boolean -> defaults false
    })
    expect(prefs.keywords).toEqual(["payout", "kyc"])
    expect(prefs.expand).toBe(true)
    expect(prefs.expandedTerms).toEqual(["refund"])
    expect(prefs.expandedFor).toBe("payout,kyc")
    expect(prefs.audiences).toEqual(["creator", "fan"]) // "bogus" dropped
    expect(prefs.priorityOnly).toBe(false)
  })

  it("caps keywords at 20 and expandedTerms at 60", () => {
    const manyKeywords = Array.from({ length: 30 }, (_, i) => `kw${i}`)
    const manyExpanded = Array.from({ length: 90 }, (_, i) => `term${i}`)
    const prefs = normalizeTriagePrefs({ keywords: manyKeywords, expandedTerms: manyExpanded })
    expect(prefs.keywords).toHaveLength(20)
    expect(prefs.expandedTerms).toHaveLength(60)
  })
})
