import { NextResponse, after } from "next/server"

import { runTriggerForEvent, verifyIntercomSignature } from "@/lib/automation/webhook"
import { runReplyQueuePipeline } from "@/lib/reply-queue-pipeline"
import { removeTriageItems } from "@/lib/triage/store"

// Keep the triage pool fresh in real time: the moment a conversation stops
// being "open + unassigned" — someone (our button, another teammate, or Fin)
// claims it, or it closes — it no longer belongs in the Triage panel. The
// sweep would catch this eventually, but it runs on an interval and can lag or
// come back partial, so a stale row lingers and reappears on poll. This reads
// the assignee/state straight off the webhook item and evicts immediately,
// covering EVERY assignment source (not just our own assign buttons).
function reconcileTriagePoolFromEvent(payload: unknown): void {
  const item = (payload as { data?: { item?: Record<string, unknown> } })?.data?.item
  if (!item) return
  const id = item.id != null ? String(item.id) : ""
  if (!id) return

  const assignee = item.admin_assignee_id
  const assigned = assignee != null && String(assignee) !== "0"
  const closed = item.state === "closed" || item.open === false

  if (assigned || closed) {
    void removeTriageItems([id]).catch(() => {})
  }
}

// Intercom webhook → automation triggers. Authenticated by HMAC signature (no user
// session), so proxy.ts exempts /api/webhooks/*. Subscribe topics in the Intercom
// developer hub (e.g. conversation.user.created, conversation.admin.assigned,
// conversation.user.replied). Set INTERCOM_CLIENT_SECRET to the app's client secret.
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const raw = await req.text()
  const ok = verifyIntercomSignature(
    raw,
    req.headers.get("x-hub-signature"),
    process.env.INTERCOM_CLIENT_SECRET
  )
  if (!ok) return NextResponse.json({ error: "Invalid signature" }, { status: 401 })

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  try {
    const outcome = await runTriggerForEvent(payload as Parameters<typeof runTriggerForEvent>[0], Date.now())

    // Autonomous reply-queue pipeline (gate -> Notion -> generate -> persist a
    // suggestion). Heavy (~seconds), so run it AFTER the 200 via after() — the
    // webhook must reply fast or Intercom retries and we'd double-compute.
    // Draft-only: the pipeline only writes a suggestion, never sends/assigns.
    // Real-time triage-pool reconcile — cheap DB delete, runs regardless of
    // whether any automation trigger matched. Kept out of after() so it lands
    // promptly, but never throws into the ack path.
    try {
      reconcileTriagePoolFromEvent(payload)
    } catch {
      // best-effort; the sweep is the backstop
    }

    const origin = new URL(req.url).origin
    after(async () => {
      try {
        await runReplyQueuePipeline(
          payload as Parameters<typeof runReplyQueuePipeline>[0],
          origin
        )
      } catch {
        // Already 200'd; a pipeline failure must not affect the webhook ack.
      }
    })

    // Always 200 so Intercom doesn't retry on benign no-ops.
    return NextResponse.json({ ok: true, outcome })
  } catch (e) {
    // Log-and-200: a thrown trigger shouldn't make Intercom hammer retries.
    return NextResponse.json({ ok: false, error: (e as Error).message })
  }
}
