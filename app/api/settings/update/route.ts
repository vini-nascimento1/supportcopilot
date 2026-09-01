import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"

import { getSignedInEmail } from "@/lib/auth"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

type UpdateBody = {
  name?: string | null
  agentName?: string | null
  timezone?: string | null
  workingDays?: number[] | null
}

export async function POST(req: Request) {
  // Session-scoped write: which agent's row this updates is decided by the
  // signed-in session, never by a value the request body could carry. A
  // client-supplied email here would let any signed-in agent overwrite
  // another agent's name/agent_name/timezone/working_days just by editing
  // the request body.
  const email = await getSignedInEmail()
  if (!email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }

  const body = (await req.json()) as UpdateBody

  const supabase = getSupabaseAdminClient()
  if (!supabase) {
    return NextResponse.json({ error: "Supabase admin client unavailable" }, { status: 500 })
  }

  // Partial patch: only fields actually present in the body are touched.
  // This lets callers update a single field (e.g. the Home "set your agent
  // name" gate posting only { agentName }) without wiping the others back to
  // null — the full Settings > Profile form still sends all four keys on
  // every save, so its existing "explicit blank clears the field" behavior
  // is unchanged.
  const patch: Record<string, string | number[] | null> = {}
  if ("name" in body) patch.name = body.name || null
  if ("agentName" in body) patch.agent_name = body.agentName || null
  if ("timezone" in body) patch.timezone = body.timezone || null
  if ("workingDays" in body) patch.working_days = body.workingDays || null

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 })
  }

  const { data: agent, error } = await supabase
    .from("agents")
    .update(patch)
    .eq("email", email)
    .select("id")
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Invalidate metrics cache so next fetch recomputes with new working days.
  if (agent?.id && "workingDays" in body) {
    await supabase.from("metrics_cache").delete().eq("agent_id", agent.id)
  }

  revalidatePath("/settings")
  revalidatePath("/")
  return NextResponse.json({ ok: true })
}
