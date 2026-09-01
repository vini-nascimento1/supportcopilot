// Shared client-side contract for the AI reply queue, used by BOTH surfaces:
// the Canvas sidebar tab (components/canvas/queue-panel.tsx) and the standalone
// mobile/web page (components/queue/queue-list.tsx, rendered at /queue).
//
// The point of this module is that the audited outbound path — POST
// /api/draft/send followed by POST /api/reply-queue/resolve — exists exactly
// once. Two copies of it would eventually drift, and a drift here means a real
// customer message going out with the wrong confirmation flag or a queue row
// that never clears.
//
// Nothing here decides *whether* to send. Callers gate that: a needs_check
// (locked) draft only gets here after the agent confirmed the fadmin check
// (Canvas: the row's two-step confirm; /queue and Home: the locked variant of
// SendConfirmDialog).

import { readApiError } from "@/lib/api-error"

// Mirrors lib/reply-queue-store.ts QueueItem (defined locally — that module is
// server-only, can't be imported into a client component).
export type RiskBand = "ready" | "needs_check" | "low_confidence"
export type SuggestionSource = { title?: string; url?: string; kind?: string }
export type QueueItem = {
  id: string
  intercomConversationId: string
  ownerId: string | null
  customerName: string | null
  subject: string | null
  body: string
  justification: string
  sources: SuggestionSource[]
  confidence: number | null
  riskBand: RiskBand
  createdAt: string
}

// A non-read conversation whose AI draft is still being generated (no ready row
// yet). Mirrors the `drafting` payload from /api/reply-queue. `waitingSince` is
// when the customer's message landed (Intercom waiting_since) — the basis for
// telling a fresh placeholder from one that's been silently failing.
export type DraftingItem = {
  conversationId: string
  customerName: string | null
  subject: string | null
  waitingSince: string | null
}

/** Shape of GET /api/reply-queue, as far as the two UIs care. */
export type QueueResponse = {
  items: QueueItem[]
  drafting: DraftingItem[]
  onRequest: QueueItem[]
  error: string | null
}

/** Oldest suggestion first — the order both surfaces work the queue in. */
export const byOldest = (a: QueueItem, b: QueueItem) =>
  new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()

/** True for a draft the server will refuse to send without a fadmin check. */
export const isLocked = (item: QueueItem) => item.riskBand === "needs_check"

/**
 * Read GET /api/reply-queue into the shape above, tolerating a partial or
 * error response (the route answers 200 with an `error` string when Intercom
 * is unreachable rather than emptying the queue).
 */
export async function fetchQueue(): Promise<QueueResponse> {
  const res = await fetch("/api/reply-queue")
  const data = (await res.json()) as Partial<QueueResponse> & { error?: unknown }
  return {
    items: Array.isArray(data.items) ? data.items : [],
    drafting: Array.isArray(data.drafting) ? data.drafting : [],
    onRequest: Array.isArray(data.onRequest) ? data.onRequest : [],
    error: typeof data.error === "string" ? data.error : null,
  }
}

export type SendResult = { ok: boolean; resolvedOk: boolean; error?: string }

/**
 * The single source of truth for the audited send path — POST /api/draft/send
 * then POST /api/reply-queue/resolve.
 *
 * `needsCheckConfirmed` is passed explicitly by the caller rather than derived
 * from the band: the server refuses a locked draft without it (409), and only
 * a UI that actually ran a fadmin-check confirm is entitled to assert it.
 * /queue and Home pass true only after the locked confirm dialog.
 */
export async function postSendAndResolve(
  item: QueueItem,
  body: string,
  options: { needsCheckConfirmed: boolean }
): Promise<SendResult> {
  const bodyChanged = body.trim() !== item.body.trim()
  try {
    const res = await fetch("/api/draft/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: item.intercomConversationId,
        body,
        needsCheckConfirmed: options.needsCheckConfirmed,
      }),
    })
    if (!res.ok) {
      return {
        ok: false,
        resolvedOk: false,
        error: await readApiError(res, `Failed to send (${res.status})`),
      }
    }
  } catch (error) {
    return {
      ok: false,
      resolvedOk: false,
      error:
        error instanceof Error ? error.message : "Couldn't send. Open the case and try there.",
    }
  }

  // The queue-clearing resolve call is best-effort — the send already went out,
  // so a failure here just means the row lingers until the next reconcile.
  const resolveRes = await fetch("/api/reply-queue/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversationId: item.intercomConversationId,
      suggestionId: item.id,
      action: bodyChanged ? "edit" : "approve",
      bodyChanged,
      finalBody: body,
    }),
  }).catch(() => null)

  return { ok: true, resolvedOk: !!resolveRes?.ok }
}

/** Shared reject/dismiss path — a single resolve call, no outbound send. */
export async function postReject(item: QueueItem): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/reply-queue/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: item.intercomConversationId,
        suggestionId: item.id,
        action: "reject",
      }),
    })
    if (!res.ok) return { ok: false, error: await res.text() }
    return { ok: true }
  } catch {
    return { ok: false, error: "Couldn't dismiss this suggestion." }
  }
}

/**
 * Claim an unassigned conversation in Intercom, which also re-runs the draft
 * with the agent's own Notion access. A human-gated Intercom write — never
 * called without a click.
 */
export async function postAssignToMe(
  item: QueueItem
): Promise<{ ok: boolean; drafted: boolean; error?: string }> {
  try {
    const res = await fetch("/api/reply-queue/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: item.intercomConversationId }),
    })
    if (!res.ok) {
      return { ok: false, drafted: false, error: await readApiError(res, "Couldn't assign this case.") }
    }
    const data = (await res.json().catch(() => null)) as { drafted?: boolean } | null
    return { ok: true, drafted: data?.drafted !== false }
  } catch {
    return { ok: false, drafted: false, error: "Couldn't assign this case." }
  }
}

/** Deep link into the Intercom inbox — the fallback surface everywhere. */
export function intercomConversationUrl(
  conversationId: string,
  appId: string | null | undefined
): string | null {
  if (!appId) return null
  return `https://app.intercom.com/a/inbox/${appId}/inbox/conversation/${conversationId}`
}
