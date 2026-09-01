import { describe, it, expect } from "vitest"

import {
  MAX_GMAIL_THREAD_CHECKS,
  MAX_SLACK_CHANNEL_CHECKS,
  planReadChecks,
  resolveReadItems,
} from "./read-signals"
import type { AttentionItem, ReadSignal } from "./types"

// The pure half of the read-signal check. The rule that matters most here is
// the negative one: "unknown" must never resolve to "read", because a wrong
// answer silently deletes a real question from the agent's page.

const NOW = Date.parse("2026-09-01T12:00:00.000Z")

const item = (id: string, readSignal?: ReadSignal): AttentionItem => ({
  id,
  source: readSignal?.kind === "gmail_thread" ? "gmail" : "slack",
  kind: "slack_mention",
  title: "Ada asked about a payout",
  context: "#support",
  urgency: "now",
  occurredAt: new Date(NOW - 60_000).toISOString(),
  whenLabel: "1 min ago",
  deepLink: "https://fanvue.slack.com/archives/C1/p1",
  externalId: id,
  actions: ["open"],
  ...(readSignal ? { readSignal } : {}),
})

const slackItem = (id: string, channelId: string, ts: string) =>
  item(id, { kind: "slack_channel", channelId, ts })

const gmailItem = (id: string, threadId: string) =>
  item(id, { kind: "gmail_thread", threadId })

describe("planReadChecks", () => {
  it("collects one entry per channel and thread, ignoring items with no signal", () => {
    const plan = planReadChecks([
      slackItem("slack:C1:100.0001", "C1", "100.0001"),
      slackItem("slack:C1:100.0002", "C1", "100.0002"),
      slackItem("slack:C2:100.0003", "C2", "100.0003"),
      gmailItem("gmail:t1", "t1"),
      item("slack:C9:1.1"), // a threaded mention: no reliable signal
    ])

    expect(plan.slackChannels).toEqual(["C1", "C2"])
    expect(plan.gmailThreads).toEqual(["t1"])
  })

  it("returns nothing when no item carries a signal", () => {
    expect(planReadChecks([item("slack:C1:1.1"), item("intercom:1")])).toEqual({
      slackChannels: [],
      gmailThreads: [],
    })
  })

  it("caps the fan-out so a busy briefing cannot become dozens of API calls", () => {
    const items = [
      ...Array.from({ length: 40 }, (_, i) => slackItem(`slack:C${i}:1.1`, `C${i}`, "1.1")),
      ...Array.from({ length: 40 }, (_, i) => gmailItem(`gmail:t${i}`, `t${i}`)),
    ]
    const plan = planReadChecks(items)

    expect(plan.slackChannels).toHaveLength(MAX_SLACK_CHANNEL_CHECKS)
    expect(plan.gmailThreads).toHaveLength(MAX_GMAIL_THREAD_CHECKS)
  })
})

describe("resolveReadItems", () => {
  const empty = { lastReadByChannel: {}, unreadByThread: {} }

  it("marks a Slack mention read once the channel cursor has passed its ts", () => {
    const items = [
      slackItem("slack:C1:1712345678.000100", "C1", "1712345678.000100"),
      slackItem("slack:C1:1712345999.000100", "C1", "1712345999.000100"),
    ]
    const read = resolveReadItems(items, {
      ...empty,
      lastReadByChannel: { C1: "1712345678.000100" },
    })

    // The cursor equals the first ts (read) and is behind the second (unread).
    expect(read).toEqual(["slack:C1:1712345678.000100"])
  })

  it("compares cursors numerically, not as strings", () => {
    // Lexically "1712345678.000090" > "1712345678.0001", numerically it is not.
    const items = [slackItem("slack:C1:a", "C1", "1712345678.000100")]
    expect(
      resolveReadItems(items, { ...empty, lastReadByChannel: { C1: "1712345678.000090" } })
    ).toEqual([])
  })

  it("treats an unknown channel or an unparseable ts as not read", () => {
    const items = [
      slackItem("slack:C1:1.1", "C1", "1712345678.000100"), // no cursor at all
      slackItem("slack:C2:bad", "C2", "not-a-ts"),
      slackItem("slack:C3:1.1", "C3", "1712345678.000100"),
    ]
    const read = resolveReadItems(items, {
      ...empty,
      lastReadByChannel: { C2: "1712999999.000100", C3: "also-broken" },
    })

    expect(read).toEqual([])
  })

  it("marks a Gmail item read only on an explicit not-unread answer", () => {
    const items = [
      gmailItem("gmail:read", "t-read"),
      gmailItem("gmail:unread", "t-unread"),
      gmailItem("gmail:unknown", "t-unknown"),
    ]
    const read = resolveReadItems(items, {
      ...empty,
      unreadByThread: { "t-read": false, "t-unread": true },
    })

    expect(read).toEqual(["gmail:read"])
  })

  it("never marks an item that carries no signal, whatever the state says", () => {
    // A mention inside a thread: the channel cursor is far ahead of its ts, and
    // it must still survive, because last_read says nothing about threads.
    const threaded = item("slack:C1:1712345678.000100")
    const read = resolveReadItems([threaded], {
      ...empty,
      lastReadByChannel: { C1: "1799999999.000100" },
    })

    expect(read).toEqual([])
  })

  it("returns nothing for an empty list or an empty state", () => {
    expect(resolveReadItems([], empty)).toEqual([])
    expect(resolveReadItems([slackItem("slack:C1:1.1", "C1", "1.1")], empty)).toEqual([])
  })
})
