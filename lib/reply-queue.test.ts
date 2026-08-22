import { describe, it, expect } from "vitest"

import {
  isNonRead,
  hasCapabilityGap,
  deriveRiskBand,
  deriveEvidenceRiskBand,
  isSendLocked,
  classifyWebhookTopic,
  hasBodyChanged,
  selectDepartedDrafts,
  STALE_GRACE_MS,
  LOCKED_CATEGORIES,
} from "./reply-queue"

describe("isNonRead", () => {
  it("is true when the customer spoke last", () => {
    expect(isNonRead("user")).toBe(true)
    expect(isNonRead("lead")).toBe(true)
    expect(isNonRead("contact")).toBe(true)
    expect(isNonRead("User")).toBe(true) // case-insensitive
  })

  it("is false when we (admin/bot) spoke last, or unknown", () => {
    expect(isNonRead("admin")).toBe(false)
    expect(isNonRead("bot")).toBe(false)
    expect(isNonRead(null)).toBe(false)
    expect(isNonRead(undefined)).toBe(false)
    expect(isNonRead("")).toBe(false)
  })
})

describe("hasCapabilityGap", () => {
  it("matches locked categories case-insensitively and as substrings", () => {
    expect(hasCapabilityGap(["payout"])).toBe(true)
    expect(hasCapabilityGap(["Payout Issue"])).toBe(true)
    expect(hasCapabilityGap(["kyc-review"])).toBe(true)
    expect(hasCapabilityGap(["Banned user"])).toBe(true)
    expect(hasCapabilityGap(["media"])).toBe(true)
    expect(hasCapabilityGap(["general", "KYC"])).toBe(true)
    expect(hasCapabilityGap(["MassPay payout"])).toBe(true)
    expect(hasCapabilityGap(["compliance-review"])).toBe(true)
    expect(hasCapabilityGap(["content moderation"])).toBe(true)
  })

  it("is false for non-sensitive or empty tags", () => {
    expect(hasCapabilityGap(["login", "refund"])).toBe(false)
    expect(hasCapabilityGap([])).toBe(false)
    expect(hasCapabilityGap(null)).toBe(false)
    expect(hasCapabilityGap(undefined)).toBe(false)
  })

  it("covers every declared locked category", () => {
    for (const cat of LOCKED_CATEGORIES) {
      expect(hasCapabilityGap([cat])).toBe(true)
    }
  })
})

describe("deriveRiskBand", () => {
  it("capability gap always wins -> needs_check, even with a gate match", () => {
    expect(
      deriveRiskBand({ capabilityGap: true, gateMatched: true, notionHadHits: true })
    ).toBe("needs_check")
  })

  it("head (playbook matched) -> ready", () => {
    expect(
      deriveRiskBand({ capabilityGap: false, gateMatched: true, notionHadHits: false })
    ).toBe("ready")
  })

  it("tail with Notion hits -> ready", () => {
    expect(
      deriveRiskBand({ capabilityGap: false, gateMatched: false, notionHadHits: true })
    ).toBe("ready")
  })

  it("tail with weak/no Notion -> low_confidence", () => {
    expect(
      deriveRiskBand({ capabilityGap: false, gateMatched: false, notionHadHits: false })
    ).toBe("low_confidence")
  })

  it("documents the defect v2 fixes: a gate match alone earns the top band", () => {
    // Kept as a characterisation test. This is exactly why matched drafts
    // outperformed nothing-matched ones on approval (57.6% vs 67.5%): the gate
    // could be wrong and the card still arrived as "ready".
    expect(
      deriveRiskBand({ capabilityGap: false, gateMatched: true, notionHadHits: false })
    ).toBe("ready")
  })

  it("playbook requiring a manual action -> needs_check, even on a clean gate match", () => {
    expect(
      deriveRiskBand({
        capabilityGap: false,
        gateMatched: true,
        notionHadHits: true,
        playbookRequiresManualAction: true,
      })
    ).toBe("needs_check")
  })
})

describe("deriveEvidenceRiskBand", () => {
  const base = {
    capabilityGap: false,
    abstained: false,
    topScore: 0.03,
    agreedCount: 1,
    customerSafeCount: 2,
  }

  it("keeps the capability-gap lock as the highest-priority rule", () => {
    expect(deriveEvidenceRiskBand({ ...base, capabilityGap: true })).toBe("needs_check")
  })

  it("keeps the manual-action lock", () => {
    expect(deriveEvidenceRiskBand({ ...base, playbookRequiresManualAction: true })).toBe("needs_check")
  })

  it("promotes to ready only when both arms agreed on something customer-safe", () => {
    expect(deriveEvidenceRiskBand(base)).toBe("ready")
  })

  it("does NOT promote a single-arm hit — this is the 57.6% defect", () => {
    // v1 would have called this "ready" purely because a playbook matched.
    expect(deriveEvidenceRiskBand({ ...base, agreedCount: 0 })).toBe("low_confidence")
  })

  it("does NOT promote when the only evidence is internal-only", () => {
    // Internal material shapes what the agent does, never what the customer is
    // told — so there is nothing to ground a customer-facing reply on.
    expect(deriveEvidenceRiskBand({ ...base, customerSafeCount: 0 })).toBe("low_confidence")
  })

  it("bands a deliberate abstain as low_confidence, not ready", () => {
    expect(
      deriveEvidenceRiskBand({ ...base, abstained: true, topScore: null, agreedCount: 0, customerSafeCount: 0 })
    ).toBe("low_confidence")
  })

  it("still locks a capability-gap card even when it abstained", () => {
    expect(
      deriveEvidenceRiskBand({ ...base, capabilityGap: true, abstained: true, agreedCount: 0 })
    ).toBe("needs_check")
  })

  it("only ever returns the three existing band values, so the UI and send-lock are unchanged", () => {
    const cases = [
      base,
      { ...base, agreedCount: 0 },
      { ...base, capabilityGap: true },
      { ...base, abstained: true },
    ]
    for (const c of cases) {
      expect(["ready", "needs_check", "low_confidence"]).toContain(deriveEvidenceRiskBand(c))
    }
  })
})

describe("isSendLocked", () => {
  it("locks only capability-gap cards", () => {
    expect(isSendLocked("needs_check")).toBe(true)
    expect(isSendLocked("ready")).toBe(false)
    expect(isSendLocked("low_confidence")).toBe(false)
  })
})

describe("hasBodyChanged", () => {
  it("is false when the text is identical", () => {
    expect(hasBodyChanged("Hi there, thanks!", "Hi there, thanks!")).toBe(false)
  })

  it("is false for whitespace/newline-only differences", () => {
    expect(hasBodyChanged("Hi there.\n\nThanks!", "Hi   there. Thanks!")).toBe(false)
    expect(hasBodyChanged("  Hi there  ", "Hi there")).toBe(false)
  })

  it("is true for a real word change", () => {
    expect(hasBodyChanged("Hi there, thanks!", "Hi there, thank you!")).toBe(true)
  })
})

describe("classifyWebhookTopic", () => {
  it("treats customer created/replied (user/contact/lead) as 'customer'", () => {
    expect(classifyWebhookTopic("conversation.user.created")).toBe("customer")
    expect(classifyWebhookTopic("conversation.user.replied")).toBe("customer")
    expect(classifyWebhookTopic("conversation.contact.replied")).toBe("customer")
    expect(classifyWebhookTopic("conversation.lead.replied")).toBe("customer")
  })

  it("treats an admin reply as 'agent_reply'", () => {
    expect(classifyWebhookTopic("conversation.admin.replied")).toBe("agent_reply")
  })

  it("treats admin non-reply events and everything else as 'other'", () => {
    expect(classifyWebhookTopic("conversation.admin.assigned")).toBe("other")
    expect(classifyWebhookTopic("conversation.admin.noted")).toBe("other")
    expect(classifyWebhookTopic("conversation.admin.closed")).toBe("other")
    expect(classifyWebhookTopic("conversation.rating.added")).toBe("other")
    expect(classifyWebhookTopic(null)).toBe("other")
    expect(classifyWebhookTopic(undefined)).toBe("other")
  })
})

describe("selectDepartedDrafts", () => {
  const NOW = Date.parse("2026-08-22T18:00:00.000Z")
  // Comfortably outside the grace period.
  const OLD = new Date(NOW - STALE_GRACE_MS - 60_000).toISOString()
  const draft = (over: Partial<Parameters<typeof selectDepartedDrafts>[0][number]> = {}) => ({
    intercomConversationId: "c1",
    onRequest: false,
    createdAt: OLD,
    ...over,
  })

  it("retires an aged auto draft whose conversation left the non-read set", () => {
    expect(selectDepartedDrafts([draft()], new Set(), NOW)).toEqual(["c1"])
  })

  it("keeps a draft whose conversation is still non-read", () => {
    expect(selectDepartedDrafts([draft()], new Set(["c1"]), NOW)).toEqual([])
  })

  // On-request drafts are durable: the reconcilers only ever redraft NON-READ
  // conversations, so retiring one deletes it with nothing able to recreate it.
  it("never retires an on-request draft, however old", () => {
    const ancient = new Date(NOW - 90 * 24 * 60 * 60 * 1000).toISOString()
    const pending = [draft({ onRequest: true, createdAt: ancient })]
    expect(selectDepartedDrafts(pending, new Set(), NOW)).toEqual([])
  })

  // Intercom's search index lags, so a just-written draft is routinely absent
  // from the non-read set. Staling it would destroy a live draft and then block
  // its regeneration behind the attempt marker.
  it("spares a draft inside the grace period even though it looks departed", () => {
    const fresh = new Date(NOW - 60_000).toISOString()
    expect(selectDepartedDrafts([draft({ createdAt: fresh })], new Set(), NOW)).toEqual([])
  })

  it("treats the grace boundary as exclusive", () => {
    const exactly = new Date(NOW - STALE_GRACE_MS).toISOString()
    expect(selectDepartedDrafts([draft({ createdAt: exactly })], new Set(), NOW)).toEqual([])
    const justPast = new Date(NOW - STALE_GRACE_MS - 1).toISOString()
    expect(selectDepartedDrafts([draft({ createdAt: justPast })], new Set(), NOW)).toEqual(["c1"])
  })

  it("keeps a draft with an unparseable timestamp rather than assuming it is old", () => {
    expect(selectDepartedDrafts([draft({ createdAt: "not a date" })], new Set(), NOW)).toEqual([])
  })

  it("partitions a mixed batch, returning only the ids safe to retire", () => {
    const fresh = new Date(NOW - 60_000).toISOString()
    const pending = [
      draft({ intercomConversationId: "departed" }),
      draft({ intercomConversationId: "still-waiting" }),
      draft({ intercomConversationId: "on-request", onRequest: true }),
      draft({ intercomConversationId: "too-fresh", createdAt: fresh }),
    ]
    expect(selectDepartedDrafts(pending, new Set(["still-waiting"]), NOW)).toEqual(["departed"])
  })
})
