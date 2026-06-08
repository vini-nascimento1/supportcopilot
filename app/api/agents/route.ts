import { NextResponse } from "next/server"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"

export const dynamic = "force-dynamic"

/**
 * Returns all agents with their Intercom admin IDs and names.
 * Used by the UI to populate the teammate condition dropdown.
 */
export async function GET() {
  const db = getSupabaseAdminClient()
  if (!db) return NextResponse.json({ error: "no admin client" }, { status: 500 })

  const { data, error } = await db.from("agents").select("id, name, intercom_admin_id").order("name")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ agents: data ?? [] })
}
