import { NextResponse } from "next/server"

import { runTriggerForEvent, verifyIntercomSignature } from "@/lib/automation/webhook"

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
    // Always 200 so Intercom doesn't retry on benign no-ops.
    return NextResponse.json({ ok: true, outcome })
  } catch (e) {
    // Log-and-200: a thrown trigger shouldn't make Intercom hammer retries.
    return NextResponse.json({ ok: false, error: (e as Error).message })
  }
}
