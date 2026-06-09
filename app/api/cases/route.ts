import { NextResponse } from "next/server"

import { getSignedInEmail } from "@/lib/auth"
import { getOpenCasesQueue } from "@/lib/intercom"
import { getPlaybooksDashboardData } from "@/lib/playbooks"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

export const dynamic = "force-dynamic"

export async function GET() {
  const email = await getSignedInEmail()
  if (!email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }

  const playbooks = await getPlaybooksDashboardData()

  // Look up the logged-in agent's Intercom admin ID so each agent sees
  // their own queue — not the workspace default (Vincenzo's) admin.
  const supabase = getSupabaseAdminClient()
  let agentAdminId: string | null | undefined
  if (supabase) {
    const { data: agent } = await supabase
      .from("agents")
      .select("intercom_admin_id")
      .eq("email", email)
      .maybeSingle()
    agentAdminId = agent?.intercom_admin_id
  }

  const cases = await getOpenCasesQueue(playbooks.allRows, agentAdminId)

  return NextResponse.json(cases, {
    status: cases.mode === "error" ? 502 : 200,
  })
}
