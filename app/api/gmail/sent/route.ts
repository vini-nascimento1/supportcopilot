import { NextResponse } from "next/server"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getAgentTokens } from "@/lib/auth"
import { isGmailTemplateUser } from "@/lib/gmail-templates-auth"

export const dynamic = "force-dynamic"

export async function GET() {
  const tokens = await getAgentTokens()
  if (!isGmailTemplateUser(tokens.email)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 })
  }

  const admin = getSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 })
  }

  const { data, error } = await admin
    .from("gmail_sent_emails")
    .select("*")
    .or(`sent_by.eq.${tokens.email},visibility.eq.shared`)
    .order("created_at", { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

// Bulk-remove tracker entries. Body: { ids: string[] }. Scoped to the caller's own
// records (sent_by), same as the single-item DELETE — shared entries authored by
// others are silently skipped. Only removes our tracking rows; the Gmail messages
// are untouched. Returns { deleted } so the UI can report how many actually went.
export async function DELETE(request: Request) {
  const tokens = await getAgentTokens()
  if (!isGmailTemplateUser(tokens.email)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 })
  }

  const admin = getSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 })
  }

  let ids: unknown
  try {
    ({ ids } = (await request.json()) as { ids?: unknown })
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string") || ids.length === 0) {
    return NextResponse.json({ error: "ids must be a non-empty string array" }, { status: 400 })
  }

  const { data, error } = await admin
    .from("gmail_sent_emails")
    .delete()
    .in("id", ids as string[])
    .eq("sent_by", tokens.email)
    .select("id")

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ deleted: data?.length ?? 0 })
}
