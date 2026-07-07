import type { IntercomReplyPayload } from "./payload"

const INTERCOM_API = "https://api.intercom.io"
const SEND_TIMEOUT_MS = 12_000
const CONFIRM_TIMEOUT_MS = 5_000
const MAX_RATE_LIMIT_RETRIES = 2
const FALLBACK_RATE_LIMIT_DELAY_MS = 1_500
const MAX_RATE_LIMIT_DELAY_MS = 10_000

type FetchLike = typeof fetch

export type SendIntercomReplyResult =
  | {
      ok: true
      status: number
      attempts: number
      confirmedBy: "reply-response" | "conversation-check"
    }
  | {
      ok: false
      status: number
      attempts: number
      error: string
      clientStatus: number
    }

export async function sendIntercomReply(input: {
  token: string
  conversationId: string
  payload: IntercomReplyPayload
  fetchImpl?: FetchLike
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  sendTimeoutMs?: number
  confirmTimeoutMs?: number
  maxRateLimitRetries?: number
}): Promise<SendIntercomReplyResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  const sleep = input.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const now = input.now ?? Date.now
  const startedAtSec = Math.floor(now() / 1000) - 60
  const sendTimeoutMs = input.sendTimeoutMs ?? SEND_TIMEOUT_MS
  const confirmTimeoutMs = input.confirmTimeoutMs ?? CONFIRM_TIMEOUT_MS
  const maxRateLimitRetries = input.maxRateLimitRetries ?? MAX_RATE_LIMIT_RETRIES
  let attempts = 0

  for (;;) {
    attempts += 1
    try {
      const response = await fetchWithTimeout(
        fetchImpl,
        `${INTERCOM_API}/conversations/${input.conversationId}/reply`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${input.token}`,
            "Content-Type": "application/json",
            "Intercom-Version": "2.11",
          },
          body: JSON.stringify(input.payload),
        },
        sendTimeoutMs
      )

      if (response.ok) {
        return {
          ok: true,
          status: response.status,
          attempts,
          confirmedBy: "reply-response",
        }
      }

      const text = await response.text().catch(() => "")
      if (response.status === 429 && attempts <= maxRateLimitRetries) {
        await sleep(getRateLimitDelayMs(response.headers, now(), attempts - 1))
        continue
      }

      const confirmed = await confirmReplyVisible({
        token: input.token,
        conversationId: input.conversationId,
        payload: input.payload,
        sinceSec: startedAtSec,
        fetchImpl,
        timeoutMs: confirmTimeoutMs,
      })
      if (confirmed) {
        return {
          ok: true,
          status: response.status,
          attempts,
          confirmedBy: "conversation-check",
        }
      }

      return {
        ok: false,
        status: response.status,
        attempts,
        clientStatus: response.status === 429 ? 429 : 502,
        error: intercomError(response.status, text),
      }
    } catch (error) {
      const confirmed = await confirmReplyVisible({
        token: input.token,
        conversationId: input.conversationId,
        payload: input.payload,
        sinceSec: startedAtSec,
        fetchImpl,
        timeoutMs: confirmTimeoutMs,
      })
      if (confirmed) {
        return {
          ok: true,
          status: 200,
          attempts,
          confirmedBy: "conversation-check",
        }
      }

      const timedOut = isAbortError(error)
      return {
        ok: false,
        status: timedOut ? 504 : 502,
        attempts,
        clientStatus: timedOut ? 504 : 502,
        error: timedOut
          ? "Intercom did not confirm the reply before the timeout. The queue was not marked sent."
          : `Intercom request failed: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal, cache: "no-store" })
  } finally {
    clearTimeout(timer)
  }
}

function getRateLimitDelayMs(headers: Headers, nowMs: number, attempt: number): number {
  const reset = Number(headers.get("x-ratelimit-reset"))
  const resetDelay = Number.isFinite(reset) ? reset * 1000 - nowMs + 250 : NaN
  if (Number.isFinite(resetDelay) && resetDelay > 0) {
    return Math.min(resetDelay, MAX_RATE_LIMIT_DELAY_MS)
  }
  return Math.min(FALLBACK_RATE_LIMIT_DELAY_MS * 2 ** attempt, MAX_RATE_LIMIT_DELAY_MS)
}

async function confirmReplyVisible(input: {
  token: string
  conversationId: string
  payload: IntercomReplyPayload
  sinceSec: number
  fetchImpl: FetchLike
  timeoutMs: number
}): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(
      input.fetchImpl,
      `${INTERCOM_API}/conversations/${input.conversationId}`,
      {
        headers: {
          Authorization: `Bearer ${input.token}`,
          "Intercom-Version": "2.11",
        },
      },
      input.timeoutMs
    )
    if (!response.ok) return false
    const conversation = (await response.json()) as IntercomConversationCheck
    if (!input.payload.body.trim()) {
      return conversation.waiting_since === null
    }
    const expected = normalizeText(input.payload.body)
    return getConversationParts(conversation).some((part) => {
      const createdAt = typeof part.created_at === "number" ? part.created_at : 0
      if (createdAt < input.sinceSec) return false
      const authorType = part.author?.type?.toLowerCase()
      const authorId = part.author?.id != null ? String(part.author.id) : null
      if (authorType !== "admin" && authorType !== "team") return false
      if (authorId && authorId !== input.payload.admin_id) return false
      return normalizeText(part.body ?? "") === expected
    })
  } catch {
    return false
  }
}

type IntercomConversationCheck = {
  waiting_since?: number | null
  conversation_parts?: {
    conversation_parts?: IntercomConversationPart[]
  } | null
}

type IntercomConversationPart = {
  body?: string | null
  created_at?: number | null
  author?: {
    id?: string | number | null
    type?: string | null
  } | null
}

function getConversationParts(conversation: IntercomConversationCheck): IntercomConversationPart[] {
  return conversation.conversation_parts?.conversation_parts ?? []
}

function normalizeText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
}

function intercomError(status: number, body: string): string {
  const suffix = summarizeErrorBody(body)
  if (status === 429) {
    return `Intercom rate-limited the send after retrying.${suffix}`
  }
  return `Intercom returned ${status}.${suffix}`
}

function summarizeErrorBody(body: string): string {
  const trimmed = body.replace(/\s+/g, " ").trim()
  return trimmed ? ` ${trimmed.slice(0, 300)}` : ""
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
}
