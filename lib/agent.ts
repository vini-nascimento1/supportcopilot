import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getSignedInEmail } from "@/lib/auth"

export type AgentProfile = {
  firstName: string
  name: string | null
  email: string | null
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
    email: email ?? null,
    intercomAdminId: process.env.INTERCOM_ADMIN_ID ?? null,
  }

  if (!email) return fallback

  const supabase = getSupabaseAdminClient()
  if (!supabase) return fallback

  const { data } = await supabase
    .from("agents")
    .select("name, email, intercom_admin_id")
    .eq("email", email)
    .maybeSingle()

  if (!data) return fallback

  return {
    firstName: data.name ? data.name.split(" ")[0]! : firstNameFromEmail(email),
    name: data.name ?? null,
    email: data.email ?? email,
    intercomAdminId: data.intercom_admin_id ?? process.env.INTERCOM_ADMIN_ID ?? null,
  }
}

export function getGreeting(isoNow: string): string {
  const hour = new Date(isoNow).getHours()
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}
