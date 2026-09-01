import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"

// The single place customer-facing code resolves an agent's name from.
//
// `agents.name` is the INTERNAL display name (Google profile name, shown in
// the sidebar/greeting, editable in Settings > Profile as "Display name
// (internal)"). `agents.agent_name` is the SEPARATE, agent-chosen name that
// customers actually see in drafts, greetings, and quick-send emails —
// editable in Settings > Profile as "Agent name (customers see this)".
//
// This module reads `agent_name` only. It must never fall back to `name` —
// that was the bug (real Google names leaking into customer-facing text and
// overwriting whatever the agent typed in Settings). Callers that need a
// customer-facing string handle `agentName: null` themselves via the existing
// generic "the support team" fallback, which `buildAgentGreeting()`
// (lib/draft-ai.ts) already treats as "no name" and drops the "I'm X" clause
// for.
export type CustomerFacingIdentity = {
  agentName: string | null
  intercomAdminId: string | null
  signature: string | null
}

const EMPTY_IDENTITY: CustomerFacingIdentity = {
  agentName: null,
  intercomAdminId: null,
  signature: null,
}

export async function getCustomerFacingIdentity(
  email: string | null | undefined
): Promise<CustomerFacingIdentity> {
  if (!email) return EMPTY_IDENTITY

  const db = getSupabaseAdminClient()
  if (!db) return EMPTY_IDENTITY

  const { data } = await db
    .from("agents")
    .select("agent_name, intercom_admin_id")
    .eq("email", email)
    .maybeSingle()

  const agentName = (data?.agent_name as string | null | undefined)?.trim() || null

  return {
    agentName,
    intercomAdminId: (data?.intercom_admin_id as string | undefined) ?? null,
    signature: agentName ? `${agentName}, Fanvue Support` : null,
  }
}
