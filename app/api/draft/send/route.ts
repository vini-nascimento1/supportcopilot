import { type NextRequest } from "next/server"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getSignedInEmail } from "@/lib/auth"
import { mdToHtml } from "@/lib/md-to-html"
import { buildIntercomReplyPayload } from "./payload"

const INTERCOM_TOKEN = process.env.INTERCOM_ACCESS_TOKEN
const INTERCOM_API = "https://api.intercom.io"

export async function POST(req: NextRequest) {
  const email = await getSignedInEmail()
  if (!email) {
    return new Response("Unauthorized", { status: 401 })
  }

  const { conversationId, body, html, attachmentFiles } = (await req.json()) as {
    conversationId: string
    body: string
    /** When true, body is already HTML (e.g. an Intercom macro) — send as-is
        instead of converting markdown. */
    html?: boolean
    attachmentFiles?: { name: string; contentType: string; data: string }[]
  }

  if (!conversationId || (!body && !(attachmentFiles && attachmentFiles.length))) {
    return new Response("Missing conversationId or body", { status: 400 })
  }

  // Look up the logged-in agent's Intercom admin ID
  const supabase = getSupabaseAdminClient()
  if (!supabase || !INTERCOM_TOKEN) {
    return new Response("Server misconfigured", { status: 500 })
  }

  const { data: agent } = await supabase
    .from("agents")
    .select("intercom_admin_id")
    .eq("email", email)
    .maybeSingle()

  const adminId = agent?.intercom_admin_id ?? process.env.INTERCOM_ADMIN_ID
  if (!adminId) {
    return new Response("No Intercom admin ID found for your account", { status: 400 })
  }

  // Macros arrive as HTML already; drafts are markdown and need conversion.
  const htmlBody = html ? body : mdToHtml(body)

  // Send reply to Intercom
  const response = await fetch(`${INTERCOM_API}/conversations/${conversationId}/reply`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${INTERCOM_TOKEN}`,
      "Content-Type": "application/json",
      "Intercom-Version": "2.11",
    },
    body: JSON.stringify(
      buildIntercomReplyPayload({ adminId: String(adminId), htmlBody, attachmentFiles })
    ),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "Unknown error")
    console.error("Intercom reply failed:", response.status, text)
    return new Response(`Intercom returned ${response.status}`, { status: 502 })
  }

  return Response.json({ ok: true })
}
