import { NextResponse } from "next/server"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { listIntercomAdmins, type IntercomAdmin } from "@/lib/intercom"

export const dynamic = "force-dynamic"

type AgentOption = {
  id: string
  name: string | null
  intercom_admin_id: string | null
}

/**
 * Returns all available teammates — merges Intercom admins (the complete team)
 * with our local agents table (for app-registered users). The UI uses this to
 * populate the teammate condition dropdown.
 *
 * Intercom admins missing from our agents table get an empty `id` (no app
 * registration) but a valid `intercom_admin_id` so they still appear in the
 * dropdown.
 */
export async function GET() {
  const db = getSupabaseAdminClient()
  if (!db) return NextResponse.json({ error: "no admin client" }, { status: 500 })

  // Fetch Intercom admins (the full team) and our registered agents in parallel.
  const [intercomAdmins, dbResult] = await Promise.all([
    listIntercomAdmins(),
    db.from("agents").select("id, name, intercom_admin_id"),
  ])

  if (dbResult.error) return NextResponse.json({ error: dbResult.error.message }, { status: 500 })

  const localAgents = (dbResult.data ?? []) as AgentOption[]
  const localByIntercomId = new Map<string, AgentOption>()
  for (const a of localAgents) {
    if (a.intercom_admin_id) localByIntercomId.set(a.intercom_admin_id, a)
  }

  // Merge: Intercom admins are the source of truth. If they're also in our
  // agents table we use our name (friendlier), otherwise use Intercom's name.
  const merged: AgentOption[] = intercomAdmins.map((ia: IntercomAdmin) => {
    const local = localByIntercomId.get(ia.id)
    return {
      id: local?.id ?? "",
      name: local?.name ?? ia.name,
      intercom_admin_id: ia.id,
    }
  })

  // Append local-only agents that have no intercom_admin_id set (edge case).
  for (const a of localAgents) {
    if (!a.intercom_admin_id && !merged.find((m) => m.id === a.id)) {
      merged.push(a)
    }
  }

  return NextResponse.json({ agents: merged })
}
