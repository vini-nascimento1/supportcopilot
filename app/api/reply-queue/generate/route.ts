import { NextResponse, after } from "next/server"

import { getSignedInEmail } from "@/lib/auth"
import { computeAndPersistSuggestion } from "@/lib/reply-queue-pipeline"

export const dynamic = "force-dynamic"

// Cap on-demand generation per request — bounds background LLM work the same way
// the queue backfill does (BACKFILL_MAX). Anything beyond the cap is dropped and
// reported back so the caller can surface "generated N of M".
const ON_REQUEST_MAX = 15

// On-demand AI reply generation for the signed-in agent: (re)generate and persist
// a queue draft for one or more conversations the agent picked from the Inbox —
// the per-card "Generate" button and the bulk "Generate all" action. Unlike the
// always-on pipeline (which only drafts NON-READ conversations), this drafts ANY
// assigned conversation, including already-read ones; those persist with
// on_request = true and surface in the Queue's durable "On request" group (never
// staled by the non-read reconciliation — see /api/reply-queue).
//
// Generation is heavy (Intercom + playbooks + Notion + LLM), so it runs in the
// background via after(); the response returns immediately and the drafts appear
// on the next Queue poll. The owner gate inside computeAndPersistSuggestion keeps
// this owner-scoped — a draft is only ever written for the conversation's current
// assignee, so this never produces a draft the caller couldn't already see.
//
// DRAFT-ONLY: only writes a suggested_replies row. Never sends, never assigns.
export async function POST(request: Request) {
  const email = await getSignedInEmail()
  if (!email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const raw: unknown = body?.conversationIds
  const ids = Array.isArray(raw)
    ? Array.from(
        new Set(raw.filter((x): x is string => typeof x === "string" && x.length > 0))
      )
    : []
  if (ids.length === 0) {
    return NextResponse.json({ error: "conversationIds is required" }, { status: 400 })
  }

  const toGenerate = ids.slice(0, ON_REQUEST_MAX)
  const dropped = ids.length - toGenerate.length
  const { origin } = new URL(request.url)

  after(async () => {
    for (const id of toGenerate) {
      await computeAndPersistSuggestion(id, origin, { onRequest: true }).catch(() => {})
    }
  })

  return NextResponse.json({ started: toGenerate.length, dropped })
}
