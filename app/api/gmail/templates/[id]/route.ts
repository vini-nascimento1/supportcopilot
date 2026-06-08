import { NextResponse } from "next/server"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getAgentTokens } from "@/lib/auth"
import { isGmailTemplateUser } from "@/lib/gmail-templates-auth"

export const dynamic = "force-dynamic"

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tokens = await getAgentTokens()
  if (!isGmailTemplateUser(tokens.email)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 })
  }

  const admin = getSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 })
  }

  const { id } = await params
  const body = (await request.json()) as {
    name?: string
    recipient?: string
    subject?: string
    body?: string
    cc?: string
    access_emails?: string
  }

  const updates: Record<string, string | null> = {}
  if (body.name !== undefined) updates.name = body.name
  if (body.recipient !== undefined) updates.recipient = body.recipient
  if (body.subject !== undefined) updates.subject = body.subject
  if (body.body !== undefined) updates.body = body.body
  if (body.cc !== undefined) updates.cc = body.cc
  if (body.access_emails !== undefined) updates.access_emails = body.access_emails

  const { data, error } = await admin
    .from("gmail_templates")
    .update(updates)
    .eq("id", id)
    .select()
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 })
  }

  return NextResponse.json(data)
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const tokens = await getAgentTokens()
  if (!isGmailTemplateUser(tokens.email)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 })
  }

  const admin = getSupabaseAdminClient()
  if (!admin) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 })
  }

  const { id } = await params

  const { error } = await admin.from("gmail_templates").delete().eq("id", id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
