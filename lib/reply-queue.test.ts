import { describe, it, expect } from "vitest"

import {
  isNonRead,
  hasCapabilityGap,
  deriveRiskBand,
  isSendLocked,
  classifyWebhookTopic,
  hasBodyChanged,
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
