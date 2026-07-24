import { getSignedInEmail } from "@/lib/auth"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { listIntercomMacros } from "@/lib/intercom"

export const dynamic = "force-dynamic"

// Pull all macros from Intercom and upsert them into intercom_macros.
// Service-role write (bypasses RLS); gated behind a signed-in agent.
export async function POST() {
  const email = await getSignedInEmail()
  if (!email) return new Response("Unauthorized", { status: 401 })

  const supabase = getSupabaseAdminClient()
  if (!supabase) return new Response("Server misconfigured", { status: 500 })

  let macros
  try {
    macros = await listIntercomMacros()
  } catch (e) {
    console.error("Macro sync: Intercom fetch failed", e)
    return new Response(`Intercom fetch failed: ${(e as Error).message}`, { status: 502 })
  }

  if (macros.length === 0) {
    return Response.json({ ok: true, synced: 0 })
  }

  const rows = macros.map((m) => ({
    intercom_id: m.intercomId,
    name: m.name,
    body: m.body,
    body_text: m.bodyText,
    visibility: m.visibility,
    intercom_updated_at: m.intercomUpdatedAt,
  }))

  const { error } = await supabase
    .from("intercom_macros")
    .upsert(rows, { onConflict: "intercom_id" })

  if (error) {
    console.error("Macro sync: upsert failed", error)
    return new Response(`Upsert failed: ${error.message}`, { status: 500 })
  }

  return Response.json({ ok: true, synced: rows.length })
}
