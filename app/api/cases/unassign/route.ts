import { type NextRequest } from "next/server"
import { getSignedInEmail, resolveIntercomAdminId } from "@/lib/auth"
import { unassignConversation } from "@/lib/intercom"

export const dynamic = "force-dynamic"

// Move an Intercom conversation back to the unassigned pool. Real write — only
// reached via an explicit human click in the canvas (see ADR-0011). The
// signed-in agent is the actor; the conversation ends up assigned to nobody.
export async function POST(req: NextRequest) {
  const email = await getSignedInEmail()
  if (!email) return new Response("Unauthorized", { status: 401 })

  const { conversationId } = (await req.json()) as { conversationId?: string }
  if (!conversationId) return new Response("Missing conversationId", { status: 400 })

  const adminId = await resolveIntercomAdminId(email)
  if (!adminId) {
    return new Response("No Intercom admin ID found for your account", { status: 400 })
  }

  const result = await unassignConversation(conversationId, adminId)
  if (!result.ok) {
    console.error("Unassign conversation failed:", result.status, result.error)
    return new Response(`Intercom returned ${result.status}`, { status: 502 })
  }

  return Response.json({ ok: true })
}
