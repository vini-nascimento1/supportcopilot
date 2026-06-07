import { NextResponse } from "next/server"

import { getSignedInEmail } from "@/lib/auth"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

// Agent alert inbox. GET = this agent's alerts (unread by default); PATCH = mark read.
// Scoped to the signed-in agent's own rules (automation rules are per-agent, ADR-0007).
export const dynamic = "force-dynamic"

async function resolveAgentId(email: string) {
  const db = getSupabaseAdminClient()
  if (!db) return { db: null, agentId: null as string | null }
  const { data } = await db.from("agents").select("id").eq("email", email).maybeSingle()
  return { db, agentId: (data?.id as string | undefined) ?? null }
}

export async function GET(req: Request) {
  const email = await getSignedInEmail()
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

  const { db, agentId } = await resolveAgentId(email)
  if (!db || !agentId) return NextResponse.json({ alerts: [] })

  const includeRead = new URL(req.url).searchParams.get("all") === "1"
  let query = db
    .from("automation_alerts")
    .select("id, rule_id, case_id, kind, body, read_at, created_at, automation_rules!inner(name, owner_id)")
    .eq("automation_rules.owner_id", agentId)
    .order("created_at", { ascending: false })
    .limit(100)
  if (!includeRead) query = query.is("read_at", null)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ alerts: data ?? [] })
}

export async function PATCH(req: Request) {
  const email = await getSignedInEmail()
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401 })

  const { db, agentId } = await resolveAgentId(email)
  if (!db || !agentId) return NextResponse.json({ error: "Unknown agent" }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as { ids?: string[] }
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === "string") : []
  if (ids.length === 0) return NextResponse.json({ error: "no ids" }, { status: 400 })

  // Restrict to alerts belonging to this agent's rules.
  const { data: owned } = await db
    .from("automation_alerts")
    .select("id, automation_rules!inner(owner_id)")
    .eq("automation_rules.owner_id", agentId)
    .in("id", ids)
  const ownedIds = (owned ?? []).map((r: { id: string }) => r.id)
  if (ownedIds.length === 0) return NextResponse.json({ updated: 0 })

  const { error } = await db
    .from("automation_alerts")
    .update({ read_at: new Date().toISOString() })
    .in("id", ownedIds)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ updated: ownedIds.length })
}
