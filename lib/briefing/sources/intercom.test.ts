import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/intercom", () => ({ getNonReadAssignedConversations: vi.fn() }))
vi.mock("@/lib/reply-queue-store", () => ({ getPendingSuggestionsForAgent: vi.fn() }))

import { getNonReadAssignedConversations, type NonReadConversation } from "@/lib/intercom"
import { getPendingSuggestionsForAgent, type QueueItem } from "@/lib/reply-queue-store"
import { collectIntercomItems, toPreparedSourceKind, toTicketItem } from "./intercom"

const NOW = Date.parse("2026-09-01T12:00:00.000Z")

const conversation = (over: Partial<NonReadConversation> = {}): NonReadConversation => ({
  id: "conv-1",
  customer: "Ada Lovelace",
  subject: "My payout is still pending after four days",
  waitingSince: new Date(NOW - 26 * 60_000).toISOString(),
  ...over,
})

const queueItem = (over: Partial<QueueItem> = {}): QueueItem => ({
  id: "sugg-1",
  intercomConversationId: "conv-1",
  ownerId: "agent-1",
  customerName: "Ada Lovelace",
  subject: "My payout is still pending after four days",
  body: "Hey! 👋 I've checked your payout and it's with the provider now.",
  justification: "matched the payout playbook",
  sources: [{ title: "Payouts & KYC playbook", url: "https://notion.so/x", kind: "playbook" }],
  confidence: 0.8,
  riskBand: "ready",
  onRequest: false,
  createdAt: new Date(NOW - 20 * 60_000).toISOString(),
  ...over,
})

describe("toTicketItem", () => {
  it("normalizes a drafted conversation into a ready-to-review item", () => {
    const item = toTicketItem(conversation(), queueItem(), NOW)

    expect(item).toMatchObject({
      id: "intercom:conv-1",
      source: "intercom",
      kind: "ticket_awaiting_reply",
      urgency: "now",
      whenLabel: "Waiting 26 min",
      externalId: "conv-1",
    })
    expect(item.title).toBe("Reply to Ada")
    expect(item.actions).toEqual(["reply", "open"])
    expect(item.pending).toBeUndefined()
    expect(item.prepared).toEqual({
      kind: "draft",
      body: "Hey! 👋 I've checked your payout and it's with the provider now.",
      suggestionId: "sugg-1",
      band: "ready",
      sources: [{ kind: "playbook", label: "Payouts & KYC playbook", url: "https://notion.so/x" }],
    })
  })

  it("never puts the customer's full name or email in the title", () => {
    const item = toTicketItem(
      conversation({ customer: "ada.lovelace@example.com" }),
      queueItem(),
      NOW
    )
    expect(item.title).toBe("Reply to a customer")
    expect(item.title).not.toContain("@")
  })

  it("marks an undrafted conversation pending with no prepared reply", () => {
    const item = toTicketItem(conversation(), null, NOW)
    expect(item.pending).toBe(true)
    expect(item.prepared).toBeUndefined()
    expect(item.actions).toEqual(["open"])
  })

  it("carries the send lock onto a needs_check draft", () => {
    const item = toTicketItem(conversation(), queueItem({ riskBand: "needs_check" }), NOW, [
      "Payout Issue",
    ])
    expect(item.prepared).toMatchObject({
      band: "needs_check",
      lockReason: "Verify the payout in fadmin before sending.",
    })
  })

  it("leaves lockReason off an unlocked band", () => {
    const item = toTicketItem(conversation(), queueItem({ riskBand: "low_confidence" }), NOW)
    expect(item.prepared && "lockReason" in item.prepared).toBe(false)
  })
})

describe("toPreparedSourceKind", () => {
  it("maps the corpus/Notion kinds onto the contract's closed set", () => {
    expect(toPreparedSourceKind("playbook")).toBe("playbook")
    expect(toPreparedSourceKind("macro")).toBe("macro")
    expect(toPreparedSourceKind("slack")).toBe("slack")
    // Anything unrecognised arrives via the Notion connector.
    expect(toPreparedSourceKind("google-drive")).toBe("notion")
    expect(toPreparedSourceKind(undefined)).toBe("notion")
  })
})

describe("collectIntercomItems", () => {
  beforeEach(() => {
    vi.mocked(getNonReadAssignedConversations).mockReset()
    vi.mocked(getPendingSuggestionsForAgent).mockReset()
  })

  it("reports not_connected when the agent has no Intercom admin id", async () => {
    const result = await collectIntercomItems({ agentId: "agent-1", adminId: null, nowMs: NOW })
    expect(result.items).toEqual([])
    expect(result.status).toEqual({ source: "intercom", state: "not_connected" })
    expect(getNonReadAssignedConversations).not.toHaveBeenCalled()
  })

  it("reports an error rather than an empty queue when Intercom is unreachable", async () => {
    vi.mocked(getPendingSuggestionsForAgent).mockResolvedValue([queueItem()])
    vi.mocked(getNonReadAssignedConversations).mockResolvedValue(null)

    const result = await collectIntercomItems({ agentId: "agent-1", adminId: "adm", nowMs: NOW })
    expect(result.items).toEqual([])
    expect(result.status.state).toBe("error")
  })

  it("drops a cached draft whose conversation has left the non-read set", async () => {
    // The agent already answered conv-1; only conv-2 is still waiting on us.
    vi.mocked(getPendingSuggestionsForAgent).mockResolvedValue([queueItem()])
    vi.mocked(getNonReadAssignedConversations).mockResolvedValue([
      conversation({ id: "conv-2", customer: "Grace Hopper" }),
    ])

    const result = await collectIntercomItems({ agentId: "agent-1", adminId: "adm", nowMs: NOW })
    expect(result.items.map((i) => i.id)).toEqual(["intercom:conv-2"])
    expect(result.items[0].pending).toBe(true)
    expect(result.status).toEqual({ source: "intercom", state: "ok", count: 1 })
  })
})
