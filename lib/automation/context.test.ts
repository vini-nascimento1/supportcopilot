import { describe, it, expect } from "vitest"

import { buildContext, type CaseMeta, type ConversationLive } from "./context"

const NOW = new Date("2026-08-12T12:00:00.000Z").getTime()

const conv = (overrides: Partial<ConversationLive> = {}): ConversationLive => ({
  intercomConversationId: "c1",
  intercomState: "open",
  subject: "Payout stuck",
  tags: ["payout"],
  customerName: "Jane",
  isCreator: true,
  priority: "priority",
  createdAt: "2026-08-12T10:00:00.000Z", // 2h before NOW
  updatedAt: "2026-08-12T11:00:00.000Z", // 1h before NOW
  adminAssigneeId: "111",
  slaStatus: "active",
  waitingSinceSec: Math.floor(NOW / 1000) - 900, // waiting 15 min
  firstAdminReplyAtSec: null,
  ...overrides,
})

const meta = (overrides: Partial<CaseMeta> = {}): CaseMeta => ({
  caseId: "case-1",
  priorityHint: "urgent",
  autoTags: ["escalated"],
  matchedPlaybook: "payout_delay",
  ...overrides,
})

describe("buildContext", () => {
  it("null conv and null meta produce empty/null fields, not throwing", () => {
    const ctx = buildContext(null, null, "conversation.user.created", NOW)
    expect(ctx.fields.status).toBeNull()
    expect(ctx.fields.tags).toEqual([])
    expect(ctx.fields.auto_tags).toEqual([])
    expect(ctx.fields.priority_hint).toBeNull()
    expect(ctx.fields.is_creator).toBeNull()
    expect(ctx.fields.human_assigned).toBeNull()
    expect(ctx.fields.admin_replied).toBeNull()
    expect(ctx.fields.sla_status).toBe("none")
    expect(ctx.fields.time_waiting_seconds).toBeNull()
    expect(ctx.fields.time_since_update).toBeUndefined()
    expect(ctx.fields.event).toBe("conversation.user.created")
  })

  it("computes time_since_update / time_since_created in whole seconds from ISO timestamps", () => {
    const ctx = buildContext(conv(), meta(), null, NOW)
    expect(ctx.fields.time_since_update).toBe(3600) // 1h
    expect(ctx.fields.time_since_created).toBe(7200) // 2h
  })

  it("an invalid/unparseable timestamp yields undefined age rather than NaN", () => {
    const ctx = buildContext(conv({ updatedAt: "not-a-date" }), null, null, NOW)
    expect(ctx.fields.time_since_update).toBeUndefined()
  })

  it("missing timestamp yields undefined age", () => {
    const ctx = buildContext(conv({ updatedAt: null }), null, null, NOW)
    expect(ctx.fields.time_since_update).toBeUndefined()
  })

  describe("time_waiting_seconds — only meaningful while the SLA clock is active", () => {
    it("active clock: computed from waitingSinceSec", () => {
      const ctx = buildContext(conv({ slaStatus: "active" }), null, null, NOW)
      expect(ctx.fields.time_waiting_seconds).toBe(900)
    })

    it("hit: null even though waitingSinceSec is still present (stale, must not fire)", () => {
      const ctx = buildContext(conv({ slaStatus: "hit" }), null, null, NOW)
      expect(ctx.fields.time_waiting_seconds).toBeNull()
    })

    it("missed: null", () => {
      const ctx = buildContext(conv({ slaStatus: "missed" }), null, null, NOW)
      expect(ctx.fields.time_waiting_seconds).toBeNull()
    })

    it("none / no SLA: null", () => {
      const ctx = buildContext(conv({ slaStatus: "none", waitingSinceSec: null }), null, null, NOW)
      expect(ctx.fields.time_waiting_seconds).toBeNull()
    })

    it("active but waitingSinceSec missing: null (nothing to compute from)", () => {
      const ctx = buildContext(conv({ slaStatus: "active", waitingSinceSec: null }), null, null, NOW)
      expect(ctx.fields.time_waiting_seconds).toBeNull()
    })
  })

  describe("human_assigned — bots don't count as a human on the case", () => {
    it("real human admin id → true", () => {
      const ctx = buildContext(conv({ adminAssigneeId: "111" }), null, null, NOW)
      expect(ctx.fields.human_assigned).toBe(true)
    })

    it("bot admin id (Fin) → false", () => {
      const ctx = buildContext(conv({ adminAssigneeId: "6510758" }), null, null, NOW)
      expect(ctx.fields.human_assigned).toBe(false)
    })

    it("unassigned (null) → false", () => {
      const ctx = buildContext(conv({ adminAssigneeId: null }), null, null, NOW)
      expect(ctx.fields.human_assigned).toBe(false)
    })

    it("no conversation at all → null (unknown, not false)", () => {
      const ctx = buildContext(null, null, null, NOW)
      expect(ctx.fields.human_assigned).toBeNull()
    })
  })

  describe("admin_replied — Fin/bot replies excluded", () => {
    it("a human has replied → true", () => {
      const ctx = buildContext(conv({ firstAdminReplyAtSec: 123 }), null, null, NOW)
      expect(ctx.fields.admin_replied).toBe(true)
    })

    it("no human reply yet → false", () => {
      const ctx = buildContext(conv({ firstAdminReplyAtSec: null }), null, null, NOW)
      expect(ctx.fields.admin_replied).toBe(false)
    })

    it("no conversation → null", () => {
      const ctx = buildContext(null, null, null, NOW)
      expect(ctx.fields.admin_replied).toBeNull()
    })
  })

  it("tags vs auto_tags stay separate (Intercom tags vs our rule-written tags)", () => {
    const ctx = buildContext(
      conv({ tags: ["vip"] }),
      meta({ autoTags: ["needs_review"] }),
      null,
      NOW
    )
    expect(ctx.fields.tags).toEqual(["vip"])
    expect(ctx.fields.auto_tags).toEqual(["needs_review"])
  })

  it("priority_hint (our meta) and priority (Intercom native) are independent", () => {
    const ctx = buildContext(conv({ priority: "not_priority" }), meta({ priorityHint: "low" }), null, NOW)
    expect(ctx.fields.priority).toBe("not_priority")
    expect(ctx.fields.priority_hint).toBe("low")
  })

  it("matched_playbook comes from meta, defaults to null when no meta row", () => {
    expect(buildContext(conv(), meta({ matchedPlaybook: "kyc_issue" }), null, NOW).fields.matched_playbook).toBe(
      "kyc_issue"
    )
    expect(buildContext(conv(), null, null, NOW).fields.matched_playbook).toBeNull()
  })
})
