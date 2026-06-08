import { NextResponse } from "next/server"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"

export const dynamic = "force-dynamic"

export type ChangelogEntry = {
  id: string
  date: string
  title: string
  description: string
}

export async function GET() {
  const db = getSupabaseAdminClient()
  if (!db) return NextResponse.json({ error: "No admin client" }, { status: 500 })

  const { data, error } = await db
    .from("changelog")
    .select("id, date, title, description")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ entries: data as ChangelogEntry[] })
}
