import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { toneInstructionFor, presetStripsEmDashes } from "@/lib/tone-presets"

type ToneRow = { tone_preset: string | null; tone_custom: string | null }

export type AgentToneResolution = {
  /** Text to inject into the drafting system prompt, or undefined for the default. */
  instruction: string | undefined
  /**
   * Whether the caller should run stripEmDashes() on the FULL assembled reply
   * as a deterministic backstop. Only meaningful for callers that buffer the
   * complete response server-side (e.g. the autonomous pipeline) — a live
   * token-stream to the client can't reliably apply this mid-stream.
   */
  stripEmDashes: boolean
}

function resolveFromRow(row: ToneRow | null): AgentToneResolution {
  return {
    instruction: toneInstructionFor(row?.tone_preset, row?.tone_custom) ?? undefined,
    stripEmDashes: presetStripsEmDashes(row?.tone_preset),
  }
}

const EMPTY_RESOLUTION: AgentToneResolution = { instruction: undefined, stripEmDashes: false }

/** Tone resolution for the agent with this email, or the default (no override). */
export async function resolveToneForAgentEmail(
  email: string | null | undefined
): Promise<AgentToneResolution> {
  if (!email) return EMPTY_RESOLUTION
  const db = getSupabaseAdminClient()
  if (!db) return EMPTY_RESOLUTION
  const { data } = await db
    .from("agents")
    .select("tone_preset, tone_custom")
    .eq("email", email)
    .maybeSingle()
  return resolveFromRow(data as ToneRow | null)
}

/** Tone resolution for the agent with this id, or the default (no override). */
export async function resolveToneForAgentId(
  agentId: string | null | undefined
): Promise<AgentToneResolution> {
  if (!agentId) return EMPTY_RESOLUTION
  const db = getSupabaseAdminClient()
  if (!db) return EMPTY_RESOLUTION
  const { data } = await db
    .from("agents")
    .select("tone_preset, tone_custom")
    .eq("id", agentId)
    .maybeSingle()
  return resolveFromRow(data as ToneRow | null)
}
