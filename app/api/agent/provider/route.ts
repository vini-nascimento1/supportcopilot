import { NextResponse } from "next/server"

import { getSignedInEmail } from "@/lib/auth"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { encryptSecret, providerCryptoAvailable } from "@/lib/provider-crypto"
import { PERSONAL_AI_DEFAULTS } from "@/lib/ai-provider"

export const dynamic = "force-dynamic"

// Per-agent personal AI key management. The key itself is NEVER returned by any
// method here — GET reports only whether one is set plus the non-secret base
// URL / model. Writes are AES-256-GCM encrypted before they touch the DB.

// GET → { hasPersonalKey, baseUrl, model, defaults, cryptoAvailable }
export async function GET() {
  const email = await getSignedInEmail()
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  const db = getSupabaseAdminClient()
  if (!db) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 })

  const { data } = await db
    .from("agents")
    .select("personal_ai_key_enc, personal_ai_base_url, personal_ai_model, personal_ai_enabled")
    .eq("email", email)
    .maybeSingle()

  return NextResponse.json({
    hasPersonalKey: Boolean(data?.personal_ai_key_enc),
    enabled: (data?.personal_ai_enabled as boolean | null) ?? true,
    baseUrl: (data?.personal_ai_base_url as string | null) ?? null,
    model: (data?.personal_ai_model as string | null) ?? null,
    defaults: PERSONAL_AI_DEFAULTS,
    cryptoAvailable: providerCryptoAvailable(),
  })
}

// PATCH { enabled } → pause/resume the personal key without deleting it. When
// paused, drafting reverts to the shared app key; the stored key is untouched.
export async function PATCH(request: Request) {
  const email = await getSignedInEmail()
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  const db = getSupabaseAdminClient()
  if (!db) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 })

  let body: { enabled?: boolean }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled (boolean) is required" }, { status: 400 })
  }

  const { error } = await db
    .from("agents")
    .update({ personal_ai_enabled: body.enabled })
    .eq("email", email)
  if (error) return NextResponse.json({ error: "Failed to update" }, { status: 500 })

  return NextResponse.json({ ok: true, enabled: body.enabled })
}

// POST { apiKey?, baseUrl?, model? } → set/rotate the key and/or update config.
// apiKey is required the first time (nothing to attach config to otherwise).
export async function POST(request: Request) {
  const email = await getSignedInEmail()
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  const db = getSupabaseAdminClient()
  if (!db) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 })

  let body: { apiKey?: string; baseUrl?: string; model?: string }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const apiKey = body.apiKey?.trim()
  const baseUrl = body.baseUrl?.trim() || null
  const model = body.model?.trim() || null

  const patch: Record<string, string | boolean | null> = {
    personal_ai_base_url: baseUrl,
    personal_ai_model: model,
  }

  if (apiKey) {
    if (!providerCryptoAvailable()) {
      return NextResponse.json(
        { error: "Server key encryption is not configured (PROVIDER_ENCRYPTION_KEY). Ask your admin to set it before adding a key." },
        { status: 503 }
      )
    }
    patch.personal_ai_key_enc = encryptSecret(apiKey)
    // Saving a (new) key means the agent wants to use it — un-pause.
    patch.personal_ai_enabled = true
  } else {
    // No new key supplied — only allow config edits if a key already exists.
    const { data } = await db
      .from("agents")
      .select("personal_ai_key_enc")
      .eq("email", email)
      .maybeSingle()
    if (!data?.personal_ai_key_enc) {
      return NextResponse.json({ error: "An API key is required to enable a personal provider." }, { status: 400 })
    }
  }

  const { error } = await db.from("agents").update(patch).eq("email", email)
  if (error) return NextResponse.json({ error: "Failed to save" }, { status: 500 })

  return NextResponse.json({ ok: true, hasPersonalKey: true })
}

// DELETE → clear the personal key and its config (revert to the shared key).
export async function DELETE() {
  const email = await getSignedInEmail()
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  const db = getSupabaseAdminClient()
  if (!db) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 })

  const { error } = await db
    .from("agents")
    .update({ personal_ai_key_enc: null, personal_ai_base_url: null, personal_ai_model: null })
    .eq("email", email)
  if (error) return NextResponse.json({ error: "Failed to clear" }, { status: 500 })

  return NextResponse.json({ ok: true, hasPersonalKey: false })
}
