import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"

export async function POST(req: Request) {
  const { email, name, timezone, workingDays } = await req.json()

  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 })
  }

  const supabase = getSupabaseAdminClient()
  if (!supabase) {
    return NextResponse.json({ error: "Supabase admin client unavailable" }, { status: 500 })
  }

  const { data: agent, error } = await supabase
    .from("agents")
    .update({
      name: name || null,
      timezone: timezone || null,
      working_days: workingDays || null,
    })
    .eq("email", email)
    .select("id")
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Invalidate metrics cache so next fetch recomputes with new working days.
  if (agent?.id) {
    await supabase.from("metrics_cache").delete().eq("agent_id", agent.id)
  }

  revalidatePath("/settings")
  return NextResponse.json({ ok: true })
}
