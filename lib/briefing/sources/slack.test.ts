import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/slack", () => ({
  getSlackUserId: vi.fn(),
  getAgentUserGroups: vi.fn(),
  getUnreadDms: vi.fn(),
  searchMentions: vi.fn(),
}))
vi.mock("@/lib/supabase-admin", () => ({ getSupabaseAdminClient: vi.fn() }))

import {
  getAgentUserGroups,
  getSlackUserId,
  getUnreadDms,
  searchMentions,
  type SlackBriefingMessage,
} from "@/lib/slack"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { collectSlackItems, mentionReason, resolveSlackUserId, toSlackItem } from "./slack"

const NOW = Date.parse("2026-09-01T12:00:00.000Z")
const USER = "U0AGENT"

const message = (over: Partial<SlackBriefingMessage> = {}): SlackBriefingMessage => ({
  channelId: "D123",
  channelName: "Grace Hopper",
  ts: "1788000000.000100",
  userId: "U0GRACE",
  userName: "Grace Hopper",
  text: "can you check the payout for the creator I flagged?",
  tsSeconds: Math.floor((NOW - 15 * 60_000) / 1000),
  permalink: "https://fanvue.slack.com/archives/D123/p1788000000000100",
  ...over,
})

/** Minimal supabase chain: .from().update().eq() resolving to a thenable. */
function fakeDb() {
  const calls: unknown[] = []
  const chain = {
    update: (row: unknown) => {
      calls.push(row)
      return chain
    },
    eq: () => chain,
    then: (resolve: (v: { error: null }) => void) => Promise.resolve({ error: null }).then(resolve),
  }
  return { db: { from: () => chain } as never, calls }
}

describe("toSlackItem", () => {
  it("normalizes a DM into a 'now' item titled with a first name only", () => {
    const item = toSlackItem(message(), "dm", NOW)

    expect(item).toMatchObject({
      id: "slack:D123:1788000000.000100",
      source: "slack",
      kind: "slack_dm",
      urgency: "now",
      title: "Grace messaged you",
      whenLabel: "15 min ago",
      deepLink: "https://fanvue.slack.com/archives/D123/p1788000000000100",
      externalId: "1788000000.000100",
    })
    expect(item.actions).toEqual(["reply", "open"])
    // Research fills this in later; the source itself proposes nothing.
    expect(item.prepared).toBeUndefined()
  })

  it("normalizes a personal channel mention into a 'now' item", () => {
    const item = toSlackItem(
      message({ channelId: "C9", channelName: "payments", text: `<@${USER}> got a sec?` }),
      "mention",
      NOW
    )
    expect(item.kind).toBe("slack_mention")
    expect(item.urgency).toBe("now")
    expect(item.title).toBe("Grace mentioned you in #payments")
  })

  it("puts a user-group mention in the calmer band — anyone on the group can take it", () => {
    const item = toSlackItem(
      message({ channelId: "C9", channelName: "payments", text: "<!subteam^S1> anyone free?" }),
      "group_mention",
      NOW
    )
    expect(item.urgency).toBe("today")
    expect(item.kind).toBe("slack_mention")
  })

  it("builds a permalink when Slack did not return one", () => {
    const item = toSlackItem(message({ permalink: "" }), "dm", NOW)
    expect(item.deepLink).toBe("https://slack.com/archives/D123/p1788000000000100")
  })
})

describe("mentionReason", () => {
  it("separates a personal mention from a group one by the marker in the text", () => {
    expect(mentionReason(message({ text: `hey <@${USER}> ping` }), USER)).toBe("mention")
    expect(mentionReason(message({ text: "<!subteam^S1> ping" }), USER)).toBe("group_mention")
  })
})

describe("resolveSlackUserId", () => {
  beforeEach(() => {
    vi.mocked(getSlackUserId).mockReset()
    vi.mocked(getSupabaseAdminClient).mockReset()
  })

  it("uses the stored column without an auth.test round trip", async () => {
    const id = await resolveSlackUserId({ email: "a@fanvue.com", token: "t", storedUserId: USER })
    expect(id).toBe(USER)
    expect(getSlackUserId).not.toHaveBeenCalled()
  })

  it("resolves lazily and backfills the column for older connections", async () => {
    vi.mocked(getSlackUserId).mockResolvedValue(USER)
    const { db, calls } = fakeDb()
    vi.mocked(getSupabaseAdminClient).mockReturnValue(db)

    const id = await resolveSlackUserId({ email: "a@fanvue.com", token: "t", storedUserId: null })
    expect(id).toBe(USER)
    expect(calls).toEqual([{ slack_user_id: USER }])
  })
})

describe("collectSlackItems", () => {
  beforeEach(() => {
    vi.mocked(getSlackUserId).mockReset()
    vi.mocked(getAgentUserGroups).mockReset()
    vi.mocked(getUnreadDms).mockReset()
    vi.mocked(searchMentions).mockReset()
    vi.mocked(getSupabaseAdminClient).mockReset()
  })

  it("reports not_connected when Slack was never connected", async () => {
    const result = await collectSlackItems({
      email: "a@fanvue.com",
      slackToken: null,
      storedUserId: null,
      sinceMs: NOW - 3_600_000,
      nowMs: NOW,
    })
    expect(result.status).toEqual({ source: "slack", state: "not_connected" })
    expect(getUnreadDms).not.toHaveBeenCalled()
  })

  it("searches only for this agent and their own user groups", async () => {
    vi.mocked(getAgentUserGroups).mockResolvedValue([
      { id: "S1", handle: "support-team", name: "Support" },
    ])
    vi.mocked(getUnreadDms).mockResolvedValue([message()])
    vi.mocked(searchMentions).mockResolvedValue([
      message({
        channelId: "C9",
        channelName: "payments",
        ts: "1788000100.000200",
        text: "<!subteam^S1> who owns this?",
      }),
    ])

    const sinceMs = NOW - 3_600_000
    const result = await collectSlackItems({
      email: "a@fanvue.com",
      slackToken: "t",
      storedUserId: USER,
      sinceMs,
      nowMs: NOW,
    })

    expect(searchMentions).toHaveBeenCalledWith("t", {
      userId: USER,
      groupIds: ["S1"],
      sinceUnix: Math.floor(sinceMs / 1000),
    })
    expect(result.items.map((i) => i.kind)).toEqual(
      expect.arrayContaining(["slack_dm", "slack_mention"])
    )
    // The raw message stays in the in-memory context map, never on the item.
    expect(result.contexts.size).toBe(result.items.length)
    expect(result.status).toEqual({ source: "slack", state: "ok", count: 2 })
  })

  it("errors cleanly when the user id cannot be resolved", async () => {
    vi.mocked(getSlackUserId).mockResolvedValue(null)
    vi.mocked(getSupabaseAdminClient).mockReturnValue(null)

    const result = await collectSlackItems({
      email: "a@fanvue.com",
      slackToken: "t",
      storedUserId: null,
      sinceMs: NOW - 3_600_000,
      nowMs: NOW,
    })
    expect(result.status.state).toBe("error")
    expect(result.items).toEqual([])
  })
})
