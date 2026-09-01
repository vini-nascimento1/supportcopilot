import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/supabase-admin", () => ({ getSupabaseAdminClient: vi.fn() }))
vi.mock("@/lib/auth", () => ({ getAgentTokens: vi.fn() }))
vi.mock("@/lib/briefing/sources/intercom", () => ({ collectIntercomItems: vi.fn() }))
vi.mock("@/lib/briefing/sources/slack", () => ({ collectSlackItems: vi.fn() }))
vi.mock("@/lib/briefing/sources/gmail", () => ({ collectGmailItems: vi.fn() }))
vi.mock("@/lib/briefing/sources/calendar", () => ({ collectCalendarItems: vi.fn() }))
vi.mock("@/lib/briefing/research", () => ({ researchSlackItems: vi.fn() }))
vi.mock("@/lib/briefing/narrative", () => ({ generateNarrative: vi.fn() }))
vi.mock("@/lib/briefing/dismissals", () => ({ getDismissedIds: vi.fn() }))

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getAgentTokens } from "@/lib/auth"
import { collectIntercomItems } from "@/lib/briefing/sources/intercom"
import { collectSlackItems } from "@/lib/briefing/sources/slack"
import { collectGmailItems } from "@/lib/briefing/sources/gmail"
import { collectCalendarItems } from "@/lib/briefing/sources/calendar"
import { researchSlackItems } from "@/lib/briefing/research"
import { generateNarrative } from "@/lib/briefing/narrative"
import { getDismissedIds } from "@/lib/briefing/dismissals"
import {
  BRIEFING_TTL_MS,
  MAX_LOOKBACK_MS,
  MIN_LOOKBACK_MS,
  applyDismissals,
  buildBriefing,
  computeSince,
  markHomeSeen,
  rankItems,
} from "./build"
import { isNeedsYouNow, type AttentionItem, type Briefing } from "./types"

const NOW = Date.parse("2026-09-01T12:00:00.000Z")

const item = (over: Partial<AttentionItem> = {}): AttentionItem => ({
  id: "intercom:1",
  source: "intercom",
  kind: "ticket_awaiting_reply",
  title: "Reply to Ada",
  context: "payout pending",
  urgency: "now",
  occurredAt: new Date(NOW - 26 * 60_000).toISOString(),
  whenLabel: "Waiting 26 min",
  deepLink: "https://app.intercom.com/x",
  externalId: "1",
  actions: ["reply", "open"],
  ...over,
})

type Row = Record<string, unknown>

/** Minimal supabase double covering the select/update chains build.ts uses. */
function fakeDb(row: Row | null) {
  const updates: Row[] = []
  const chain = {
    select: () => chain,
    eq: () => chain,
    update: (patch: Row) => {
      updates.push(patch)
      return chain
    },
    maybeSingle: () => Promise.resolve({ data: row }),
    then: (resolve: (v: { error: null }) => void) => Promise.resolve({ error: null }).then(resolve),
  }
  return { db: { from: () => chain } as never, updates }
}

const agentRow = (over: Row = {}): Row => ({
  id: "agent-1",
  intercom_admin_id: "adm-1",
  slack_token: "slack-tok",
  slack_user_id: "U0AGENT",
  timezone: "Europe/London",
  last_seen_at: new Date(NOW - 3 * 3_600_000).toISOString(),
  briefing_cache: null,
  briefing_cached_at: null,
  ...over,
})

describe("computeSince", () => {
  it("uses the agent's last visit when it is older than the floor", () => {
    const lastSeen = new Date(NOW - 3 * 24 * 3_600_000).toISOString()
    expect(computeSince(lastSeen, NOW)).toBe(lastSeen)
  })

  it("never shrinks the window below the 24h floor", () => {
    const lastSeen = new Date(NOW - 2 * 3_600_000).toISOString()
    expect(computeSince(lastSeen, NOW)).toBe(new Date(NOW - MIN_LOOKBACK_MS).toISOString())
    expect(computeSince(new Date(NOW).toISOString(), NOW)).toBe(
      new Date(NOW - MIN_LOOKBACK_MS).toISOString()
    )
  })

  it("falls back to 24h for a first-ever visit", () => {
    expect(computeSince(null, NOW)).toBe(new Date(NOW - MIN_LOOKBACK_MS).toISOString())
  })

  it("covers a weekend or a few days off in full", () => {
    const friday = new Date(NOW - 5 * 24 * 3_600_000).toISOString()
    expect(computeSince(friday, NOW)).toBe(friday)
  })

  it("clamps a long absence to the 7-day window — a briefing, not an archive", () => {
    const twoWeeks = new Date(NOW - 14 * 24 * 3_600_000).toISOString()
    expect(computeSince(twoWeeks, NOW)).toBe(new Date(NOW - MAX_LOOKBACK_MS).toISOString())
  })

  it("ignores a future timestamp rather than producing an empty window", () => {
    expect(computeSince(new Date(NOW + 3_600_000).toISOString(), NOW)).toBe(
      new Date(NOW - MIN_LOOKBACK_MS).toISOString()
    )
  })
})

describe("applyDismissals", () => {
  const briefing = (items: AttentionItem[]): Briefing => ({
    generatedAt: new Date(NOW).toISOString(),
    since: new Date(NOW - MIN_LOOKBACK_MS).toISOString(),
    narrative: "Two tickets are waiting.",
    narrativeSource: "model",
    counts: { now: items.length, drafted: 0, researched: 0, locked: 0 },
    items,
    sources: [],
  })

  it("returns the briefing untouched when nothing was dismissed", () => {
    const input = briefing([item({ id: "intercom:1" })])
    expect(applyDismissals(input, new Set())).toBe(input)
    expect(applyDismissals(input, new Set(["intercom:999"]))).toBe(input)
  })

  it("drops dismissed items from the list and the counts", () => {
    const input = briefing([item({ id: "intercom:1" }), item({ id: "slack:C1:1.1" })])
    const out = applyDismissals(input, new Set(["intercom:1"]))

    expect(out.items.map((i) => i.id)).toEqual(["slack:C1:1.1"])
    expect(out.counts.now).toBe(1)
  })

  it("replaces a model narrative that no longer describes the list", () => {
    const input = briefing([item({ id: "intercom:1" }), item({ id: "intercom:2" })])
    const out = applyDismissals(input, new Set(["intercom:1", "intercom:2"]))

    expect(out.narrativeSource).toBe("fallback")
    expect(out.narrative).not.toBe("Two tickets are waiting.")
    expect(out.narrative).toContain("Nothing needs you right now")
  })
})

describe("rankItems", () => {
  it("puts 'now' first, then orders by dueAt/occurredAt", () => {
    const ranked = rankItems([
      item({ id: "c", urgency: "later", occurredAt: new Date(NOW - 60_000).toISOString() }),
      item({ id: "b", urgency: "today", occurredAt: new Date(NOW - 60_000).toISOString() }),
      item({ id: "a-new", urgency: "now", occurredAt: new Date(NOW - 60_000).toISOString() }),
      item({ id: "a-old", urgency: "now", occurredAt: new Date(NOW - 7_200_000).toISOString() }),
    ])
    expect(ranked.map((i) => i.id)).toEqual(["a-old", "a-new", "b", "c"])
  })

  it("is stable for identical keys and does not mutate its input", () => {
    const input = [item({ id: "z" }), item({ id: "a" })]
    const copy = [...input]
    expect(rankItems(input).map((i) => i.id)).toEqual(["a", "z"])
    expect(input).toEqual(copy)
  })
})

describe("isNeedsYouNow", () => {
  it("counts every human-waiting kind", () => {
    expect(isNeedsYouNow(item({ kind: "ticket_awaiting_reply" }), NOW)).toBe(true)
    expect(isNeedsYouNow(item({ kind: "slack_dm" }), NOW)).toBe(true)
    expect(isNeedsYouNow(item({ kind: "slack_mention", urgency: "now" }), NOW)).toBe(true)
    expect(isNeedsYouNow(item({ kind: "slack_mention", urgency: "today" }), NOW)).toBe(false)
    expect(isNeedsYouNow(item({ kind: "email_action" }), NOW)).toBe(true)
  })

  it("excludes the calm kinds", () => {
    expect(isNeedsYouNow(item({ kind: "email_fyi" }), NOW)).toBe(false)
    expect(isNeedsYouNow(item({ kind: "slack_thread_reply" }), NOW)).toBe(false)
  })

  it("includes a calendar event only inside the next hour", () => {
    const soon = item({ kind: "calendar_event", dueAt: new Date(NOW + 30 * 60_000).toISOString() })
    const later = item({ kind: "calendar_event", dueAt: new Date(NOW + 90 * 60_000).toISOString() })
    const past = item({ kind: "calendar_event", dueAt: new Date(NOW - 60_000).toISOString() })
    const undated = item({ kind: "calendar_event", dueAt: undefined })

    expect(isNeedsYouNow(soon, NOW)).toBe(true)
    expect(isNeedsYouNow(later, NOW)).toBe(false)
    expect(isNeedsYouNow(past, NOW)).toBe(false)
    expect(isNeedsYouNow(undated, NOW)).toBe(false)
  })
})

describe("buildBriefing", () => {
  beforeEach(() => {
    vi.mocked(getSupabaseAdminClient).mockReset()
    vi.mocked(getAgentTokens).mockReset()
    vi.mocked(collectIntercomItems).mockReset()
    vi.mocked(collectSlackItems).mockReset()
    vi.mocked(collectGmailItems).mockReset()
    vi.mocked(collectCalendarItems).mockReset()
    vi.mocked(researchSlackItems).mockReset()
    vi.mocked(generateNarrative).mockReset()
    vi.mocked(getDismissedIds).mockReset()
    vi.mocked(getDismissedIds).mockResolvedValue(new Set<string>())

    vi.mocked(getAgentTokens).mockResolvedValue({
      email: "a@fanvue.com",
      name: "Ada",
      googleToken: "g",
      slackToken: "s",
      notionToken: null,
    })
    vi.mocked(collectIntercomItems).mockResolvedValue({
      items: [item()],
      status: { source: "intercom", state: "ok", count: 1 },
    })
    vi.mocked(collectSlackItems).mockResolvedValue({
      items: [],
      contexts: new Map(),
      status: { source: "slack", state: "ok", count: 0 },
    })
    vi.mocked(collectGmailItems).mockResolvedValue({
      items: [],
      status: { source: "gmail", state: "not_connected" },
    })
    vi.mocked(collectCalendarItems).mockResolvedValue({
      items: [],
      status: { source: "calendar", state: "ok", count: 0 },
    })
    vi.mocked(researchSlackItems).mockResolvedValue(new Map())
    vi.mocked(generateNarrative).mockResolvedValue({ narrative: "One ticket.", source: "model" })
  })

  it("assembles the contract shape and caches it", async () => {
    const { db, updates } = fakeDb(agentRow())
    vi.mocked(getSupabaseAdminClient).mockReturnValue(db)

    const briefing = await buildBriefing("a@fanvue.com", { now: NOW })

    expect(briefing.generatedAt).toBe(new Date(NOW).toISOString())
    expect(briefing.narrative).toBe("One ticket.")
    expect(briefing.narrativeSource).toBe("model")
    expect(briefing.counts).toEqual({ now: 1, drafted: 0, researched: 0, locked: 0 })
    expect(briefing.items).toHaveLength(1)
    expect(briefing.sources.map((s) => s.source)).toEqual([
      "intercom",
      "slack",
      "gmail",
      "calendar",
    ])
    // Cached, and last_seen_at deliberately untouched — the Home page owns it.
    expect(updates).toEqual([
      { briefing_cache: briefing, briefing_cached_at: briefing.generatedAt },
    ])
  })

  it("serves a fresh cache without touching any source", async () => {
    const cached = {
      generatedAt: new Date(NOW - 60_000).toISOString(),
      since: new Date(NOW - 3_600_000).toISOString(),
      narrative: "cached",
      narrativeSource: "model",
      counts: { now: 0, drafted: 0, researched: 0, locked: 0 },
      items: [],
      sources: [],
    }
    const { db } = fakeDb(
      agentRow({ briefing_cache: cached, briefing_cached_at: cached.generatedAt })
    )
    vi.mocked(getSupabaseAdminClient).mockReturnValue(db)

    const briefing = await buildBriefing("a@fanvue.com", { now: NOW })
    expect(briefing.narrative).toBe("cached")
    expect(collectIntercomItems).not.toHaveBeenCalled()
  })

  it("rebuilds once the cache is past its TTL", async () => {
    const stale = new Date(NOW - BRIEFING_TTL_MS - 1_000).toISOString()
    const { db } = fakeDb(
      agentRow({ briefing_cache: { narrative: "old", items: [] }, briefing_cached_at: stale })
    )
    vi.mocked(getSupabaseAdminClient).mockReturnValue(db)

    const briefing = await buildBriefing("a@fanvue.com", { now: NOW })
    expect(briefing.narrative).toBe("One ticket.")
    expect(collectIntercomItems).toHaveBeenCalled()
  })

  it("force bypasses a fresh cache", async () => {
    const { db } = fakeDb(
      agentRow({
        briefing_cache: { narrative: "cached", items: [] },
        briefing_cached_at: new Date(NOW - 60_000).toISOString(),
      })
    )
    vi.mocked(getSupabaseAdminClient).mockReturnValue(db)

    const briefing = await buildBriefing("a@fanvue.com", { now: NOW, force: true })
    expect(briefing.narrative).toBe("One ticket.")
    expect(collectIntercomItems).toHaveBeenCalled()
  })

  it("keeps the page alive when one source throws", async () => {
    vi.mocked(collectSlackItems).mockRejectedValue(new Error("slack down"))
    const { db } = fakeDb(agentRow())
    vi.mocked(getSupabaseAdminClient).mockReturnValue(db)

    const briefing = await buildBriefing("a@fanvue.com", { now: NOW })
    expect(briefing.items).toHaveLength(1)
    expect(briefing.sources.find((s) => s.source === "slack")).toMatchObject({ state: "error" })
  })

  it("filters dismissed items out of a cache hit without rebuilding", async () => {
    const cached = {
      generatedAt: new Date(NOW - 60_000).toISOString(),
      since: new Date(NOW - 3_600_000).toISOString(),
      narrative: "cached",
      narrativeSource: "model",
      counts: { now: 1, drafted: 0, researched: 0, locked: 0 },
      items: [item({ id: "intercom:1" })],
      sources: [],
    }
    const { db } = fakeDb(
      agentRow({ briefing_cache: cached, briefing_cached_at: cached.generatedAt })
    )
    vi.mocked(getSupabaseAdminClient).mockReturnValue(db)
    vi.mocked(getDismissedIds).mockResolvedValue(new Set(["intercom:1"]))

    const briefing = await buildBriefing("a@fanvue.com", { now: NOW })
    expect(briefing.items).toEqual([])
    expect(briefing.counts.now).toBe(0)
    expect(briefing.narrativeSource).toBe("fallback")
    expect(collectIntercomItems).not.toHaveBeenCalled()
  })

  it("caches the complete briefing but returns the filtered one", async () => {
    const { db, updates } = fakeDb(agentRow())
    vi.mocked(getSupabaseAdminClient).mockReturnValue(db)
    vi.mocked(getDismissedIds).mockResolvedValue(new Set(["intercom:1"]))

    const briefing = await buildBriefing("a@fanvue.com", { now: NOW })
    expect(briefing.items).toEqual([])
    // Undo has to be able to bring the row back without a rebuild.
    const cached = updates[0].briefing_cache as { items: AttentionItem[] }
    expect(cached.items).toHaveLength(1)
  })

  it("returns a safe empty briefing when the agent row is missing", async () => {
    const { db } = fakeDb(null)
    vi.mocked(getSupabaseAdminClient).mockReturnValue(db)

    const briefing = await buildBriefing("nobody@fanvue.com", { now: NOW })
    expect(briefing.items).toEqual([])
    expect(briefing.narrativeSource).toBe("fallback")
    expect(briefing.sources.every((s) => s.state === "error")).toBe(true)
  })
})

describe("markHomeSeen", () => {
  it("stamps last_seen_at and nothing else", async () => {
    const { db, updates } = fakeDb(agentRow())
    vi.mocked(getSupabaseAdminClient).mockReturnValue(db)

    await markHomeSeen("a@fanvue.com")
    expect(updates).toHaveLength(1)
    expect(Object.keys(updates[0])).toEqual(["last_seen_at"])
  })
})
