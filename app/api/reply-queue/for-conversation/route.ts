import { NextResponse } from "next/server"

import { getSignedInEmail } from "@/lib/auth"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getPendingSuggestionForConversation } from "@/lib/reply-queue-store"

export const dynamic = "force-dynamic"

// The pending queue suggestion for a single conversation, owner-scoped to the
// signed-in agent (same auth + scoping as /api/reply-queue). The unified
// conversation card calls this to prefill the composer from the queued draft.
// Returns { suggestion: null } when there's no pending draft for this agent.
export async function GET(request: Request) {
  const email = await getSignedInEmail()
  if (!email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }

  const conversationId = new URL(request.url).searchParams.get("conversationId")
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId is required" }, { status: 400 })
  }

  const db = getSupabaseAdminClient()
  if (!db) return NextResponse.json({ suggestion: null })

  const { data: agent } = await db
    .from("agents")
    .select("id")
    .eq("email", email)
    .maybeSingle()
  const agentId = agent?.id as string | undefined
  if (!agentId) return NextResponse.json({ suggestion: null })

  const suggestion = await getPendingSuggestionForConversation(conversationId, agentId)
  return NextResponse.json({ suggestion: suggestion ?? null })
}
