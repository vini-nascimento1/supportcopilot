import { NextResponse } from "next/server"

import { getSignedInEmail } from "@/lib/auth"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { TONE_PRESETS, TONE_SAMPLE_MESSAGE } from "@/lib/tone-presets"

export const dynamic = "force-dynamic"

const MAX_CUSTOM_TONE_CHARS = 500
const VALID_PRESET_IDS = new Set([...TONE_PRESETS.map((p) => p.id), "custom"])

// Per-agent reply tone (Settings → Reply tone). GET returns the current
// choice plus the preset catalog (with example previews) so the UI can
// render entirely from this response. POST sets preset and/or custom text.
export async function GET() {
  const email = await getSignedInEmail()
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  const db = getSupabaseAdminClient()
  if (!db) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 })

  const { data } = await db
    .from("agents")
    .select("tone_preset, tone_custom")
    .eq("email", email)
    .maybeSingle()

  return NextResponse.json({
    tonePreset: (data?.tone_preset as string | null) ?? null,
    toneCustom: (data?.tone_custom as string | null) ?? null,
    presets: TONE_PRESETS,
    sampleMessage: TONE_SAMPLE_MESSAGE,
  })
}

export async function POST(request: Request) {
  const email = await getSignedInEmail()
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  const db = getSupabaseAdminClient()
  if (!db) return NextResponse.json({ error: "Storage unavailable" }, { status: 503 })

  let body: { tonePreset?: string | null; toneCustom?: string | null }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const tonePreset = body.tonePreset ?? null
  if (tonePreset !== null && !VALID_PRESET_IDS.has(tonePreset)) {
    return NextResponse.json({ error: "Unknown tone preset" }, { status: 400 })
  }
  if (tonePreset === "custom" && !body.toneCustom?.trim()) {
    return NextResponse.json({ error: "Custom tone text is required" }, { status: 400 })
  }

  const { error } = await db
    .from("agents")
    .update({
      tone_preset: tonePreset,
      tone_custom: tonePreset === "custom" ? (body.toneCustom?.trim().slice(0, MAX_CUSTOM_TONE_CHARS) ?? null) : null,
    })
    .eq("email", email)
  if (error) return NextResponse.json({ error: "Failed to save" }, { status: 500 })

  return NextResponse.json({ ok: true })
}
