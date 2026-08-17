import { describe, it, expect } from "vitest"

import { getLiveTipForText, getTopMatches, getDraftPlaceholder } from "./case-intelligence"
import type { CaseTip } from "./case-intelligence"
import type { PlaybookListItem } from "./playbooks"

// This module has no DB/API-calling exports to skip — all 5 exports (2 types,
// 3 functions) are pure computation over already-fetched PlaybookListItem[].

const playbook = (over: Partial<PlaybookListItem>): PlaybookListItem => ({
  id: "pb-1",
  caseType: "Generic case",
  source: "test",
  aliases: [],
  lastValidated: null,
  recognize: null,
  checks: null,
  resolution: null,
  dosDonts: null,
  requiresManualAction: false,
  ...over,
})

describe("getLiveTipForText", () => {
  it("returns null when there are no playbooks", () => {
    expect(getLiveTipForText("payout delayed please help", [])).toBeNull()
  })

  it("returns null for empty text (no tokens to score against)", () => {
    const pb = playbook({ caseType: "Payout delayed", aliases: ["payout stuck"] })
    expect(getLiveTipForText("", [pb])).toBeNull()
  })

  // score = 14 (phrase "payout delayed") + 2*8 (both tokens matched) + 6 (caseType bonus) = 36 > 24
  it("scores an exact caseType phrase match with both tokens as high confidence", () => {
    const pb = playbook({ caseType: "Payout delayed", aliases: ["payout stuck"] })
    const tip = getLiveTipForText("My payout delayed again this week", [pb])
    expect(tip).not.toBeNull()
    expect(tip?.confidence).toBe("high")
    expect(tip?.trigger).toBe("Payout delayed")
  })

  // score = 12 (phrase "verification") + 1*8 (one matched token) + 0 (alias, not caseType) = 20
  it("scores a single strong-length alias match (no exact caseType phrase) as medium confidence", () => {
    const pb = playbook({ caseType: "KYC issue", aliases: ["verification"] })
    const tip = getLiveTipForText("my verification keeps failing please help", [pb])
    expect(tip).not.toBeNull()
    expect(tip?.confidence).toBe("medium")
  })

  // score = 3 (phrase "kyc") + 1*8 (domain token, short but in domainTokens) = 11 <= 12
  it("scores a short domain-token-only match (e.g. kyc) as low confidence", () => {
    const pb = playbook({ caseType: "Compliance flag", aliases: ["kyc"] })
    const tip = getLiveTipForText("I have a kyc issue that needs resolving", [pb])
    expect(tip).not.toBeNull()
    expect(tip?.confidence).toBe("low")
  })

  // "top" alone isn't a phrase match for the 2-word alias "top up", and "top"
  // is short (<5) and not a domain token, so it can't carry the match alone.
  it("rejects a short non-domain token when the full phrase never appears", () => {
    const pb = playbook({ caseType: "Wallet top up", aliases: ["top up"] })
    expect(getLiveTipForText("please move this to the top of the queue", [pb])).toBeNull()
  })

  it("picks the higher-scoring playbook when multiple match", () => {
    const weak = playbook({ id: "weak", caseType: "Weak match", aliases: ["verification"] })
    const strong = playbook({ id: "strong", caseType: "Payout delayed", aliases: ["payout stuck"] })
    const tip = getLiveTipForText("my payout delayed and verification pending", [weak, strong])
    expect(tip?.playbook).toBe("Payout delayed")
  })

  it("keeps the first playbook on an exact score tie (strict > comparison)", () => {
    const first = playbook({ id: "first", caseType: "Alpha issue", aliases: [], checks: "First checks text" })
    const second = playbook({ id: "second", caseType: "Alpha issue", aliases: [], checks: "Second checks text" })
    const tip = getLiveTipForText("this alpha issue is urgent", [first, second])
    expect(tip?.guidance).toBe("First checks text")
  })

  it("uses checks as guidance when present", () => {
    const pb = playbook({
      caseType: "Payout delayed",
      checks: "Check Fadmin before replying.",
      recognize: "Creator asks about a delayed payout.",
    })
    const tip = getLiveTipForText("my payout delayed", [pb])
    expect(tip?.guidance).toBe("Check Fadmin before replying.")
  })

  it("falls back to recognize when checks is null", () => {
    const pb = playbook({
      caseType: "Payout delayed",
      checks: null,
      recognize: "Creator asks about a delayed payout.",
    })
    const tip = getLiveTipForText("my payout delayed", [pb])
    expect(tip?.guidance).toBe("Creator asks about a delayed payout.")
  })

  it("falls back to the generic guidance string when both checks and recognize are null", () => {
    const pb = playbook({ caseType: "Payout delayed", checks: null, recognize: null })
    const tip = getLiveTipForText("my payout delayed", [pb])
    expect(tip?.guidance).toBe("Open the matched playbook before drafting a reply.")
  })

  it("ignores playbooks whose only terms are shorter than 3 normalized characters", () => {
    const pb = playbook({ caseType: "Payout delayed", aliases: ["ok", "hi"] })
    // Aliases too short to be considered are simply absent from scoring; the
    // caseType term is still there, so a matching caseType phrase still hits.
    const tip = getLiveTipForText("my payout delayed", [pb])
    expect(tip?.trigger).toBe("Payout delayed")
  })
})

describe("getTopMatches", () => {
  it("returns an empty array when nothing matches", () => {
    const pb = playbook({ caseType: "Payout delayed", aliases: [] })
    expect(getTopMatches("totally unrelated text", [pb])).toEqual([])
  })

  it("returns an empty array for an empty playbook list", () => {
    expect(getTopMatches("payout delayed", [])).toEqual([])
  })

  it("sorts matches by descending score", () => {
    const weak = playbook({ id: "weak", caseType: "Weak", aliases: ["verification"] })
    const strong = playbook({ id: "strong", caseType: "Payout delayed", aliases: ["payout stuck"] })
    const results = getTopMatches("my payout delayed and verification pending", [weak, strong])
    expect(results.map((r) => r.playbook.id)).toEqual(["strong", "weak"])
    expect(results[0].score).toBeGreaterThan(results[1].score)
  })

  it("defaults to a limit of 3 matches", () => {
    const pbs = Array.from({ length: 5 }, (_, i) =>
      playbook({ id: `pb-${i}`, caseType: `Payout delayed variant ${i}`, aliases: [] })
    )
    const results = getTopMatches("my payout delayed today", pbs)
    expect(results.length).toBeLessThanOrEqual(3)
  })

  it("honors a custom limit", () => {
    const pbs = Array.from({ length: 5 }, (_, i) =>
      playbook({ id: `pb-${i}`, caseType: `Payout delayed variant ${i}`, aliases: [] })
    )
    const results = getTopMatches("my payout delayed today", pbs, 2)
    expect(results.length).toBeLessThanOrEqual(2)
  })

  it("excludes non-matching playbooks even when others in the list match", () => {
    const matches = playbook({ id: "matches", caseType: "Payout delayed", aliases: [] })
    const noMatch = playbook({ id: "no-match", caseType: "Something else entirely", aliases: [] })
    const results = getTopMatches("my payout delayed today", [matches, noMatch])
    expect(results.map((r) => r.playbook.id)).toEqual(["matches"])
  })
})

describe("getDraftPlaceholder", () => {
  it("returns the no-tip placeholder when tip is null", () => {
    expect(getDraftPlaceholder("Customer asking about a delayed payout.", null)).toBe(
      "No draft generated yet. Match a playbook first, then draft from approved sources."
    )
  })

  it("embeds the playbook name and case summary when a tip is present", () => {
    const tip: CaseTip = {
      playbook: "Payout delayed",
      trigger: "payout delayed",
      confidence: "high",
      guidance: "Check Fadmin before replying.",
    }
    const out = getDraftPlaceholder("Creator says their payout is late.", tip)
    expect(out).toContain('"Payout delayed"')
    expect(out).toContain("Creator says their payout is late.")
    expect(out).toContain("copy-paste only")
  })
})
