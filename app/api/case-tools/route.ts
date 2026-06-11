import { NextResponse } from "next/server"

import { getSignedInEmail } from "@/lib/auth"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getAllCaseTools } from "@/lib/case-tools-db"

export const dynamic = "force-dynamic"

export async function GET() {
  const email = await getSignedInEmail()
  if (!email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }
  return NextResponse.json({ tools: await getAllCaseTools() })
}

export async function POST(request: Request) {
  const email = await getSignedInEmail()
  if (!email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }
  const supabase = getSupabaseAdminClient()
  if (!supabase) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 })
  }

  const body = await request.json()
  const { name, icon, urlTemplate, group, tags, sortOrder, isActive } = body ?? {}
  if (!name || !urlTemplate || !/^https?:\/\//.test(urlTemplate)) {
    return NextResponse.json(
      { error: "name and a valid http(s) urlTemplate are required" },
      { status: 400 },
    )
  }

  const { data, error } = await supabase
    .from("case_tools")
    .insert({
      name,
      icon: icon || null,
      url_template: urlTemplate,
      group_name: group || null,
      sort_order: typeof sortOrder === "number" ? sortOrder : 0,
      is_active: isActive !== false,
    })
    .select("id")
    .single()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 })
  }

  if (Array.isArray(tags) && tags.length > 0) {
    await supabase.from("case_tool_tags").insert(
      tags
        .filter((t: unknown): t is string => typeof t === "string" && t.trim() !== "")
        .map((tag: string) => ({ tool_id: data.id, tag: tag.trim().toLowerCase() })),
    )
  }

  return NextResponse.json({ id: data.id }, { status: 201 })
}
