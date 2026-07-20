import "server-only"

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { decryptSecret } from "@/lib/provider-crypto"

// A resolved AI provider for a single generation. When an agent sets a personal
// OpenAI-compatible key in Settings, we route THEIR drafting through it instead
// of the shared app key — lifting the shared 30 req/min router cap for that
// agent. The shared key stays the default for everyone else.
export type AiProvider = {
  baseUrl: string // OpenAI-compatible, includes the /v1 suffix
  apiKey: string
  textModel: string
  visionModel: string
  // false = personal key (own quota; the shared-key throttle is bypassed).
  shared: boolean
}

// Defaults applied when an agent stores a personal key but leaves base URL /
// model blank. GPT-5-nano is natively multimodal, so one model serves both text
// and vision — no separate vision fallback needed.
const DEFAULT_PERSONAL_BASE_URL = "https://api.openai.com/v1"
const DEFAULT_PERSONAL_MODEL = "gpt-5-nano"

type PersonalRow = {
  personal_ai_key_enc: string | null
  personal_ai_base_url: string | null
  personal_ai_model: string | null
  personal_ai_enabled: boolean | null
}

function providerFromRow(row: PersonalRow | null): AiProvider | null {
  const enc = row?.personal_ai_key_enc
  if (!enc) return null
  // Paused: the key is kept, but drafting reverts to the shared app key.
  if (row?.personal_ai_enabled === false) return null
  const apiKey = decryptSecret(enc)
  if (!apiKey) return null // bad master key / tampered value → fall back to shared
  const model = row?.personal_ai_model?.trim() || DEFAULT_PERSONAL_MODEL
  return {
    baseUrl: (row?.personal_ai_base_url?.trim() || DEFAULT_PERSONAL_BASE_URL).replace(/\/+$/, ""),
    apiKey,
    textModel: model,
    visionModel: model,
    shared: false,
  }
}

const SELECT_COLS =
  "personal_ai_key_enc, personal_ai_base_url, personal_ai_model, personal_ai_enabled"

/** Personal provider for the agent with this email, or null to use the shared key. */
export async function resolveProviderForAgentEmail(
  email: string | null | undefined
): Promise<AiProvider | null> {
  if (!email) return null
  const db = getSupabaseAdminClient()
  if (!db) return null
  const { data } = await db
    .from("agents")
    .select(SELECT_COLS)
    .eq("email", email)
    .maybeSingle()
  return providerFromRow(data as PersonalRow | null)
}

/** Personal provider for the agent with this id, or null to use the shared key. */
export async function resolveProviderForAgentId(
  agentId: string | null | undefined
): Promise<AiProvider | null> {
  if (!agentId) return null
  const db = getSupabaseAdminClient()
  if (!db) return null
  const { data } = await db
    .from("agents")
    .select(SELECT_COLS)
    .eq("id", agentId)
    .maybeSingle()
  return providerFromRow(data as PersonalRow | null)
}

export const PERSONAL_AI_DEFAULTS = {
  baseUrl: DEFAULT_PERSONAL_BASE_URL,
  model: DEFAULT_PERSONAL_MODEL,
}
