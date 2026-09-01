import { describe, it, expect } from "vitest"

import {
  ATTENTION_GROUP_ORDER,
  attentionGroup,
  isNeedsYouNow,
  type AttentionItem,
} from "./types"

const NOW = Date.parse("2026-09-01T12:00:00.000Z")

const item = (over: Partial<AttentionItem> & Pick<AttentionItem, "source" | "kind">): AttentionItem => ({
  id: "x",
  title: "t",
  context: "c",
  urgency: "now",
  occurredAt: new Date(NOW - 60_000).toISOString(),
  whenLabel: "1 min ago",
  deepLink: "https://example.test",
  externalId: "x",
  actions: ["open"],
  ...over,
})

describe("attentionGroup", () => {
  it("sends a customer ticket to Reply", () => {
    expect(attentionGroup(item({ source: "intercom", kind: "ticket_awaiting_reply" }))).toBe("reply")
  })

  it("sends a colleague's mention to Answer", () => {
    expect(
      attentionGroup(item({ source: "slack", kind: "slack_mention", actions: ["reply", "open"] }))
    ).toBe("answer")
  })

  it("sends a DM with a researched answer to Answer", () => {
    const dm = item({
      source: "slack",
      kind: "slack_dm",
      actions: ["open"],
      prepared: {
        kind: "answer",
        body: "Ground D only covers the subscription.",
        sources: [{ kind: "playbook", label: "Refund policy" }],
        replyTo: { channelId: "D123" },
      },
    })
    expect(attentionGroup(dm)).toBe("answer")
  })

  it("sends a workflow post to Decide — nobody asked anything", () => {
    expect(attentionGroup(item({ source: "slack", kind: "slack_mention", actions: ["open"] }))).toBe(
      "decide"
    )
  })

  it("sends email and calendar to Decide", () => {
    expect(attentionGroup(item({ source: "gmail", kind: "email_action" }))).toBe("decide")
    expect(attentionGroup(item({ source: "calendar", kind: "calendar_event" }))).toBe("decide")
  })

  it("only ever returns a group the UI renders", () => {
    const groups = [
      attentionGroup(item({ source: "intercom", kind: "ticket_awaiting_reply" })),
      attentionGroup(item({ source: "slack", kind: "slack_dm", actions: ["reply"] })),
      attentionGroup(item({ source: "gmail", kind: "email_fyi" })),
    ]
    expect(groups.every((g) => ATTENTION_GROUP_ORDER.includes(g))).toBe(true)
  })
})

describe("isNeedsYouNow", () => {
  it("follows the urgency the source set, so the section and counts.now agree", () => {
    const asked = item({ source: "slack", kind: "slack_mention", urgency: "now" })
    const cc = item({ source: "slack", kind: "slack_mention", urgency: "today" })

    expect(isNeedsYouNow(asked, NOW)).toBe(true)
    expect(isNeedsYouNow(cc, NOW)).toBe(false)
  })

  it("keeps a calm-band email out of the section", () => {
    expect(isNeedsYouNow(item({ source: "gmail", kind: "email_action", urgency: "today" }), NOW)).toBe(
      false
    )
    expect(isNeedsYouNow(item({ source: "gmail", kind: "email_fyi", urgency: "later" }), NOW)).toBe(
      false
    )
  })

  it("only pulls in a calendar event inside the next hour", () => {
    const soon = item({
      source: "calendar",
      kind: "calendar_event",
      dueAt: new Date(NOW + 30 * 60_000).toISOString(),
    })
    const later = item({
      source: "calendar",
      kind: "calendar_event",
      dueAt: new Date(NOW + 5 * 60 * 60_000).toISOString(),
    })
    const past = item({
      source: "calendar",
      kind: "calendar_event",
      dueAt: new Date(NOW - 60_000).toISOString(),
    })

    expect(isNeedsYouNow(soon, NOW)).toBe(true)
    expect(isNeedsYouNow(later, NOW)).toBe(false)
    expect(isNeedsYouNow(past, NOW)).toBe(false)
    expect(isNeedsYouNow(item({ source: "calendar", kind: "calendar_event" }), NOW)).toBe(false)
  })
})
