import { afterEach, describe, expect, it, vi } from "vitest"

import {
  byOldest,
  intercomConversationUrl,
  isLocked,
  postReject,
  postSendAndResolve,
  type QueueItem,
} from "@/components/queue/queue-actions"

// The Canvas panel and the standalone /queue page both go through this module,
// so its request payloads are the real contract with /api/draft/send and
// /api/reply-queue/resolve. Pin them: a silent change here would send a
// customer message with the wrong confirmation flag, or leave the queue row
// hanging because the resolve body didn't match the route.

const item: QueueItem = {
  id: "sug_1",
  intercomConversationId: "conv_1",
  ownerId: "agent_1",
  customerName: "A customer",
  subject: "Payout question",
  body: "  Original body  ",
  justification: "Matched the payout playbook.",
  sources: [],
  confidence: 0.9,
  riskBand: "ready",
  createdAt: "2026-09-01T10:00:00.000Z",
}

type Call = { url: string; body: Record<string, unknown> }

function mockFetch(responses: { ok: boolean; status?: number; text?: string }[]) {
  const calls: Call[] = []
  let i = 0
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) })
    const r = responses[i++] ?? { ok: true }
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      text: async () => r.text ?? "",
    } as unknown as Response
  })
  vi.stubGlobal("fetch", fetchMock)
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("postSendAndResolve", () => {
  it("sends the agent-supplied confirmation flag, never one derived from the band", async () => {
    const calls = mockFetch([{ ok: true }, { ok: true }])
    const locked: QueueItem = { ...item, riskBand: "needs_check" }

    await postSendAndResolve(locked, locked.body, { needsCheckConfirmed: false })

    expect(calls[0].url).toBe("/api/draft/send")
    expect(calls[0].body).toEqual({
      conversationId: "conv_1",
      body: "  Original body  ",
      needsCheckConfirmed: false,
    })
  })

  it("resolves as 'approve' when the body is untouched", async () => {
    const calls = mockFetch([{ ok: true }, { ok: true }])

    const result = await postSendAndResolve(item, item.body, { needsCheckConfirmed: false })

    expect(result).toEqual({ ok: true, resolvedOk: true })
    expect(calls[1].url).toBe("/api/reply-queue/resolve")
    expect(calls[1].body).toEqual({
      conversationId: "conv_1",
      suggestionId: "sug_1",
      action: "approve",
      bodyChanged: false,
      finalBody: "  Original body  ",
    })
  })

  it("resolves as 'edit' when the agent changed the text", async () => {
    const calls = mockFetch([{ ok: true }, { ok: true }])

    await postSendAndResolve(item, "Rewritten body", { needsCheckConfirmed: false })

    expect(calls[1].body).toMatchObject({
      action: "edit",
      bodyChanged: true,
      finalBody: "Rewritten body",
    })
  })

  it("never resolves the row when the send itself failed", async () => {
    const calls = mockFetch([
      { ok: false, status: 409, text: JSON.stringify({ error: "Locked pending a fadmin check" }) },
    ])

    const result = await postSendAndResolve(item, item.body, { needsCheckConfirmed: false })

    expect(result.ok).toBe(false)
    expect(result.error).toContain("Locked pending a fadmin check")
    expect(calls).toHaveLength(1)
  })

  it("still reports success when the send landed but the queue clear did not", async () => {
    mockFetch([{ ok: true }, { ok: false, status: 500 }])

    const result = await postSendAndResolve(item, item.body, { needsCheckConfirmed: false })

    expect(result).toMatchObject({ ok: true, resolvedOk: false })
  })
})

describe("postReject", () => {
  it("is a single resolve call with no outbound send", async () => {
    const calls = mockFetch([{ ok: true }])

    const result = await postReject(item)

    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("/api/reply-queue/resolve")
    expect(calls[0].body).toEqual({
      conversationId: "conv_1",
      suggestionId: "sug_1",
      action: "reject",
    })
  })
})

describe("helpers", () => {
  it("treats only needs_check as locked", () => {
    expect(isLocked({ ...item, riskBand: "needs_check" })).toBe(true)
    expect(isLocked({ ...item, riskBand: "ready" })).toBe(false)
    expect(isLocked({ ...item, riskBand: "low_confidence" })).toBe(false)
  })

  it("orders oldest first", () => {
    const newer = { ...item, id: "sug_2", createdAt: "2026-09-01T12:00:00.000Z" }
    expect([newer, item].sort(byOldest).map((i) => i.id)).toEqual(["sug_1", "sug_2"])
  })

  it("returns no Intercom link when the app id is missing", () => {
    expect(intercomConversationUrl("conv_1", null)).toBeNull()
    expect(intercomConversationUrl("conv_1", "app123")).toBe(
      "https://app.intercom.com/a/inbox/app123/inbox/conversation/conv_1"
    )
  })
})
