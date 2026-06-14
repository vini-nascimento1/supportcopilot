import { type NextRequest } from "next/server"
import { getSignedInEmail } from "@/lib/auth"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { closeConversation } from "@/lib/intercom"

export const dynamic = "force-dynamic"

// Close an Intercom conversation. Real write — only reached via an explicit
// human click in the canvas (see ADR-0011). Closes as the agent's own admin id.
export async function POST(req: NextRequest) {
  const email = await getSignedInEmail()
  if (!email) return new Response("Unauthorized", { status: 401 })

  const { conversationId } = (await req.json()) as { conversationId?: string }
  if (!conversationId) return new Response("Missing conversationId", { status: 400 })

  const supabase = getSupabaseAdminClient()
  if (!supabase) return new Response("Server misconfigured", { status: 500 })

  const { data: agent } = await supabase
    .from("agents")
    .select("intercom_admin_id")
    .eq("email", email)
    .maybeSingle()

  const adminId = agent?.intercom_admin_id ?? process.env.INTERCOM_ADMIN_ID
  if (!adminId) {
    return new Response("No Intercom admin ID found for your account", { status: 400 })
  }

  const result = await closeConversation(conversationId, adminId)
  if (!result.ok) {
    console.error("Close conversation failed:", result.status, result.error)
    return new Response(`Intercom returned ${result.status}`, { status: 502 })
  }

  return Response.json({ ok: true })
}
