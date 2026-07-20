import { type NextRequest } from "next/server"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { getSignedInEmail } from "@/lib/auth"
import { getConversationDetail } from "@/lib/intercom"
import {
  buildMacroAdaptSystemPrompt,
  buildMacroAdaptUserMessage,
  hasAgentPersonallyReplied,
  streamChatCompletion,
} from "@/lib/draft-ai"
import type { OpenAIMessage } from "@/lib/draft-ai"
import { resolveProviderForAgentEmail } from "@/lib/ai-provider"

async function getAgent(email: string): Promise<{ name: string; intercomAdminId: string | null }> {
  const supabase = getSupabaseAdminClient()
  if (!supabase) return { name: "the support team", intercomAdminId: null }
  const { data } = await supabase
    .from("agents")
    .select("name, intercom_admin_id")
    .eq("email", email)
    .maybeSingle()
  return {
    name: data?.name?.split(" ")[0] ?? "the support team",
    intercomAdminId: (data?.intercom_admin_id as string | undefined) ?? null,
  }
}

// Minimal server-side HTML → plain-text strip (DOMParser is client-only).
// Fallback when a macro has no body_text.
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>(?=\s*\S)/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

// ── Route handler ──────────────────────────────────────────────────────────
// D9: adapt an approved macro to THIS case via deepseek. Draft-only — the
// stream is shown for the agent to review/copy, never sent (ADR-0011).

export async function POST(req: NextRequest) {
  if (!process.env.VERBOO_API_KEY) {
    return new Response("VERBOO_API_KEY is not configured", { status: 503 })
  }

  let body: { conversationId?: string; macroId?: string }
  try {
    body = (await req.json()) as { conversationId?: string; macroId?: string }
  } catch {
    return new Response("Invalid JSON body", { status: 400 })
  }

  const { conversationId, macroId } = body
  if (!conversationId) {
    return new Response("conversationId is required", { status: 400 })
  }
  if (!macroId) {
    return new Response("macroId is required", { status: 400 })
  }

  // Require authenticated session
  const email = await getSignedInEmail()
  if (!email) {
    return new Response("Authentication required", { status: 401 })
  }

  const supabase = getSupabaseAdminClient()
  if (!supabase) {
    return new Response("Server misconfigured", { status: 500 })
  }

  // Load the macro: match by primary id first, then fall back to intercom_id.
  type MacroTextRow = { body: string | null; body_text: string | null }
  const byId = await supabase
    .from("intercom_macros")
    .select("body, body_text")
    .eq("id", macroId)
    .maybeSingle()
  let macroRow = byId.data as MacroTextRow | null
  if (!macroRow) {
    const byIntercomId = await supabase
      .from("intercom_macros")
      .select("body, body_text")
      .eq("intercom_id", macroId)
      .maybeSingle()
    macroRow = byIntercomId.data as MacroTextRow | null
  }

  if (!macroRow) {
    return new Response("Macro not found", { status: 404 })
  }

  const macroText =
    macroRow.body_text?.trim() ||
    (macroRow.body ? stripHtml(macroRow.body) : "")
  if (!macroText) {
    return new Response("Macro has no usable text", { status: 422 })
  }

  const conversation = await getConversationDetail(conversationId)
  if (!conversation) {
    return new Response("Conversation not found in Intercom", { status: 404 })
  }

  const { name: agentName, intercomAdminId } = await getAgent(email)
  const provider = (await resolveProviderForAgentEmail(email)) ?? undefined
  const hasAgentReplied = hasAgentPersonallyReplied(conversation.messages, intercomAdminId)
  const systemPrompt = buildMacroAdaptSystemPrompt(macroText, agentName, hasAgentReplied)
  const userMessage = buildMacroAdaptUserMessage(conversation, Boolean(conversation.email))

  const encoder = new TextEncoder()

  const readable = new ReadableStream({
    async start(controller) {
      try {
        const messages: OpenAIMessage[] = [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ]

        for await (const chunk of streamChatCompletion(messages, { provider })) {
          controller.enqueue(encoder.encode(chunk))
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "AI generation failed"
        controller.enqueue(encoder.encode(`[Error: ${msg}]`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
