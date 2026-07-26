import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { toneInstructionFor } from "@/lib/tone-presets"

type ToneRow = { tone_preset: string | null; tone_custom: string | null }

/** Tone instruction for the agent with this email, or undefined for the default. */
export async function resolveToneInstructionForAgentEmail(
  email: string | null | undefined
): Promise<string | undefined> {
  if (!email) return undefined
  const db = getSupabaseAdminClient()
  if (!db) return undefined
  const { data } = await db
    .from("agents")
    .select("tone_preset, tone_custom")
    .eq("email", email)
    .maybeSingle()
  return toneInstructionFor((data as ToneRow | null)?.tone_preset, (data as ToneRow | null)?.tone_custom) ?? undefined
}

/** Tone instruction for the agent with this id, or undefined for the default. */
export async function resolveToneInstructionForAgentId(
  agentId: string | null | undefined
): Promise<string | undefined> {
  if (!agentId) return undefined
  const db = getSupabaseAdminClient()
  if (!db) return undefined
  const { data } = await db
    .from("agents")
    .select("tone_preset, tone_custom")
    .eq("id", agentId)
    .maybeSingle()
  return toneInstructionFor((data as ToneRow | null)?.tone_preset, (data as ToneRow | null)?.tone_custom) ?? undefined
}
