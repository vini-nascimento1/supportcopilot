import { describe, expect, it, vi } from "vitest"

import { sendIntercomReply } from "./intercom-reply"
import type { IntercomReplyPayload } from "./payload"

const payload: IntercomReplyPayload = {
  type: "admin",
  message_type: "comment",
  admin_id: "42",
  body: "<p>Hello there</p>",
}

function asFetch(mock: ReturnType<typeof vi.fn>): typeof fetch {
  return mock as unknown as typeof fetch
}

describe("sendIntercomReply", () => {
  it("returns success when Intercom accepts the reply", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }))

    const result = await sendIntercomReply({
      token: "token",
      conversationId: "conv-1",
      payload,
      fetchImpl: asFetch(fetchMock),
    })

    expect(result).toEqual({
      ok: true,
      status: 200,
      attempts: 1,
      confirmedBy: "reply-response",
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("retries 429 responses before succeeding", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          headers: { "x-ratelimit-reset": "1001" },
        })
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
    const sleep = vi.fn(async () => {})

    const result = await sendIntercomReply({
      token: "token",
      conversationId: "conv-1",
      payload,
      fetchImpl: asFetch(fetchMock),
      sleep,
      now: () => 1_000_000,
    })

    expect(result.ok).toBe(true)
    expect(result.attempts).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(1250)
  })

  it("treats a timed-out send as successful only when the reply is visible", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("Aborted", "AbortError"))
      .mockResolvedValueOnce(
        Response.json({
          waiting_since: null,
          conversation_parts: {
            conversation_parts: [
              {
                body: "<p>Hello there</p>",
                created_at: 1_000,
                author: { id: "42", type: "admin" },
              },
            ],
          },
        })
      )

    const result = await sendIntercomReply({
      token: "token",
      conversationId: "conv-1",
      payload,
      fetchImpl: asFetch(fetchMock),
      now: () => 1_000_000,
    })

    expect(result).toEqual({
      ok: true,
      status: 200,
      attempts: 1,
      confirmedBy: "conversation-check",
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("does not report success when a failed send cannot be confirmed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
      .mockResolvedValueOnce(
        Response.json({
          waiting_since: 1_000,
          conversation_parts: { conversation_parts: [] },
        })
      )

    const result = await sendIntercomReply({
      token: "token",
      conversationId: "conv-1",
      payload,
      fetchImpl: asFetch(fetchMock),
      now: () => 1_000_000,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.clientStatus).toBe(502)
      expect(result.error).toContain("Intercom returned 502")
    }
  })
})
