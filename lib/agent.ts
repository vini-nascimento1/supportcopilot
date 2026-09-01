import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getSignedInEmail } from "@/lib/auth"
import { getCustomerFacingIdentity } from "@/lib/agent-identity"

export type AgentProfile = {
  firstName: string
  name: string | null
  /**
   * Customer-facing name (Settings > Profile, "Agent name (customers see
   * this)") — agents.agent_name, resolved via lib/agent-identity.ts. Null
   * until the agent sets it (or the auth callback backfills it from their
   * matched Intercom admin). Home gates the briefing behind this being set —
   * never fall back to `name` for customer-facing text.
   *
   * Optional (rather than required) only so pre-existing `AgentProfile`
   * fallback literals elsewhere (e.g. app/page.tsx's `safe(...)` default)
   * don't need to be touched by this change — getAgentProfile() itself
   * always sets it to a real `string | null`, never `undefined`.
   */
  agentName?: string | null
  email: string | null
  timezone: string | null
  intercomAdminId: string | null
}

export function firstNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? ""
  const part = local.split(".")[0] ?? local
  return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
}

export async function getAgentProfile(): Promise<AgentProfile> {
  const email = await getSignedInEmail()

  const fallback: AgentProfile = {
    firstName: email ? firstNameFromEmail(email) : "Agent",
    name: null,
    agentName: null,
    email: email ?? null,
    timezone: null,
    intercomAdminId: process.env.INTERCOM_ADMIN_ID ?? null,
  }

  if (!email) return fallback

  const supabase = getSupabaseAdminClient()
  if (!supabase) return fallback

  const [{ data }, identity] = await Promise.all([
    supabase
      .from("agents")
      .select("name, email, timezone, intercom_admin_id")
      .eq("email", email)
      .maybeSingle(),
    getCustomerFacingIdentity(email),
  ])

  if (!data) {
    return {
      ...fallback,
      agentName: identity.agentName,
      intercomAdminId: identity.intercomAdminId ?? fallback.intercomAdminId,
    }
  }

  return {
    firstName: data.name ? data.name.split(" ")[0]! : firstNameFromEmail(email),
    name: data.name ?? null,
    agentName: identity.agentName,
    email: data.email ?? email,
    timezone: data.timezone ?? null,
    intercomAdminId: data.intercom_admin_id ?? process.env.INTERCOM_ADMIN_ID ?? null,
  }
}

