import { NextResponse } from "next/server"

import { getSignedInEmail } from "@/lib/auth"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: Params) {
  const email = await getSignedInEmail()
  if (!email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }
  const supabase = getSupabaseAdminClient()
  if (!supabase) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 })
  }
  const { id } = await params
  const body = await request.json()

  const update: Record<string, unknown> = {}
  if (typeof body.name === "string" && body.name) update.name = body.name
  if ("icon" in body) update.icon = body.icon || null
  if (typeof body.urlTemplate === "string") {
    if (!/^https?:\/\//.test(body.urlTemplate)) {
      return NextResponse.json({ error: "urlTemplate must be http(s)" }, { status: 400 })
    }
    update.url_template = body.urlTemplate
  }
  if ("group" in body) update.group_name = body.group || null
  if (typeof body.sortOrder === "number") update.sort_order = body.sortOrder
  if (typeof body.isActive === "boolean") update.is_active = body.isActive

  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from("case_tools").update(update).eq("id", id)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 502 })
    }
  }

  if (Array.isArray(body.tags)) {
    await supabase.from("case_tool_tags").delete().eq("tool_id", id)
    const tags = body.tags
      .filter((t: unknown): t is string => typeof t === "string" && t.trim() !== "")
      .map((tag: string) => ({ tool_id: id, tag: tag.trim().toLowerCase() }))
    if (tags.length > 0) {
      await supabase.from("case_tool_tags").insert(tags)
    }
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: Request, { params }: Params) {
  const email = await getSignedInEmail()
  if (!email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }
  const supabase = getSupabaseAdminClient()
  if (!supabase) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 })
  }
  const { id } = await params
  const { error } = await supabase.from("case_tools").delete().eq("id", id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 })
  }
  return NextResponse.json({ ok: true })
}
