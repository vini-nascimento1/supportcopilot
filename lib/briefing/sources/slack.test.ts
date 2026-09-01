import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/slack", () => ({
  getSlackUserId: vi.fn(),
  getAgentUserGroups: vi.fn(),
  getUnreadDms: vi.fn(),
  searchMentions: vi.fn(),
}))
vi.mock("@/lib/supabase-admin", () => ({ getSupabaseAdminClient: vi.fn() }))
// research.ts is imported below only for selectResearchTargets, which is pure;
// its retrieval/model dependencies are stubbed so nothing reaches the network.
vi.mock("@/lib/retrieval/search", () => ({ searchKnowledge: vi.fn() }))
vi.mock("@/lib/notion-retrieval-server", () => ({ retrieveNotionSnippets: vi.fn() }))
vi.mock("@/lib/playbooks", () => ({ getPlaybooksDashboardData: vi.fn() }))
vi.mock("@/lib/draft-ai", () => ({
  streamChatCompletion: vi.fn(),
  getAuxDraftModel: () => "test-model",
}))

import {
  getAgentUserGroups,
  getSlackUserId,
  getUnreadDms,
  searchMentions,
  type SlackBriefingMessage,
} from "@/lib/slack"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import {
  collectSlackItems,
  extractTicketTitle,
  mentionReason,
  resolveSlackUserId,
  toSlackItem,
} from "./slack"
import { selectResearchTargets } from "../research"

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
    // The channel's last_read can settle whether this was read in Slack.
    expect(item.readSignal).toEqual({
      kind: "slack_channel",
      channelId: "D123",
      ts: "1788000000.000100",
    })
  })

  it("keeps a bot DM out of 'now' — a notification is not a person waiting", () => {
    const item = toSlackItem(message({ isBot: true, botName: "Zapier", userName: "Zapier" }), "dm", NOW)
    expect(item.kind).toBe("slack_dm")
    expect(item.urgency).toBe("today")
  })

  it("makes a personal mention 'now' only when it actually asks something", () => {
    const item = toSlackItem(
      message({ channelId: "C9", channelName: "payments", text: `<@${USER}> can you check this?` }),
      "mention",
      NOW
    )
    expect(item.kind).toBe("slack_mention")
    expect(item.urgency).toBe("now")
    expect(item.title).toBe("Grace mentioned you in #payments")
  })

  it("drops a cc-style mention to the digest — nobody asked for anything", () => {
    const item = toSlackItem(
      message({ channelId: "C9", channelName: "payments", text: `cc <@${USER}> for visibility` }),
      "mention",
      NOW
    )
    expect(item.kind).toBe("slack_mention")
    expect(item.urgency).toBe("today")
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

  it("omits the read signal for a threaded reply — last_read says nothing about threads", () => {
    const reply = toSlackItem(
      message({
        channelId: "C9",
        channelName: "payments",
        ts: "1788000300.000400",
        threadTs: "1788000000.000100",
        text: `<@${USER}> can you confirm?`,
      }),
      "mention",
      NOW
    )
    expect(reply.readSignal).toBeUndefined()

    // A thread PARENT is still a plain channel message, so it keeps its signal.
    const parent = toSlackItem(
      message({ channelId: "C9", ts: "1788000000.000100", threadTs: "1788000000.000100" }),
      "mention",
      NOW
    )
    expect(parent.readSignal).toMatchObject({ kind: "slack_channel", channelId: "C9" })
  })

  it("builds a permalink when Slack did not return one", () => {
    const item = toSlackItem(message({ permalink: "" }), "dm", NOW)
    expect(item.deepLink).toBe("https://slack.com/archives/D123/p1788000000000100")
  })
})

describe("toSlackItem — workflow and bot posts", () => {
  const RAISE = message({
    channelId: "C77",
    channelName: "payout-issues",
    userId: "B0RAISE",
    userName: "Raise",
    isBot: true,
    botName: "Raise",
    text:
      "A new Payout Issue ticket has been created and assigned to you: *Ticket Title* Creator cannot withdraw to MassPay *Creator Email Address* someone@example.com *Priority* High",
  })

  it("words a raised ticket as an event, not as a person mentioning you", () => {
    const item = toSlackItem(RAISE, "mention", NOW)

    expect(item.title).toBe("New ticket raised in #payout-issues")
    expect(item.context).toBe("Creator cannot withdraw to MassPay")
    // "assigned to you" is what makes a workflow post personal.
    expect(item.urgency).toBe("now")
    // Replying to a workflow bot is never right, so there is nothing but open.
    expect(item.actions).toEqual(["open"])
  })

  it("names any other bot plainly and stays in the calm band", () => {
    const item = toSlackItem(
      message({
        channelId: "C77",
        channelName: "deploys",
        isBot: true,
        botName: "Deploybot",
        userName: "Deploybot",
        text: "build 4821 finished",
      }),
      "mention",
      NOW
    )

    expect(item.title).toBe("Deploybot posted in #deploys")
    expect(item.context).toBe("build 4821 finished")
    expect(item.urgency).toBe("today")
    expect(item.actions).toEqual(["open"])
  })

  it("falls back to the sanitized text when no ticket title can be read", () => {
    const item = toSlackItem(
      message({
        channelId: "C77",
        channelName: "payout-issues",
        isBot: true,
        botName: "Raise",
        text: "A new ticket has been created",
      }),
      "mention",
      NOW
    )
    expect(item.title).toBe("New ticket raised in #payout-issues")
    expect(item.context).toBe("A new ticket has been created")
  })

  it("never sends a workflow post to the research pass", () => {
    const human = message({ channelId: "C9", ts: "1788000200.000300", text: "can you check this?" })
    const contexts = new Map([
      [
        "bot",
        { item: toSlackItem(RAISE, "mention", NOW), message: RAISE, reason: "mention" as const },
      ],
      [
        "human",
        { item: toSlackItem(human, "mention", NOW), message: human, reason: "mention" as const },
      ],
    ])

    expect(selectResearchTargets(contexts).map((c) => c.message.userName)).toEqual(["Grace Hopper"])
  })
})

describe("extractTicketTitle", () => {
  it("stops at the next field label", () => {
    expect(
      extractTicketTitle("… assigned to you: Ticket Title Payout stuck Creator Email Address a@b.c")
    ).toBe("Payout stuck")
  })

  it("stops at a line break when the workflow uses lines", () => {
    expect(extractTicketTitle("*Ticket Title*\nPayout stuck\n*Priority*\nHigh")).toBe("Payout stuck")
  })

  it("returns null rather than guessing", () => {
    expect(extractTicketTitle("a new ticket landed")).toBeNull()
    expect(extractTicketTitle("Ticket Title")).toBeNull()
    expect(extractTicketTitle("Ticket Title: ab Priority high")).toBeNull()
  })
})

describe("mentionReason", () => {
  it("separates a personal mention from a group one by the marker in the text", () => {
    expect(mentionReason(message({ text: `hey <@${USER}> ping` }), USER)).toBe("mention")
    expect(mentionReason(message({ text: "<!subteam^S1> ping" }), USER)).toBe("group_mention")
  })

  it("trusts the mentionsSelf flag once the markup has been humanized", () => {
    expect(mentionReason(message({ text: "hey @you ping", mentionsSelf: true }), USER)).toBe("mention")
    expect(mentionReason(message({ text: "hey @support-team ping", mentionsSelf: false }), USER)).toBe(
      "group_mention"
    )
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
