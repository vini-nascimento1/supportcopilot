// Playbook confidence gate — decides whether a case maps to a known playbook
// (head) or to "no playbook applies" (tail). Pure functions here are unit-tested;
// no `server-only` and no top-level I/O (mirrors lib/automation/engine.ts and
// lib/draft-ai.ts). See FanvueSupport/Engineering/Plan - Notion AI retrieval for drafting.md (D6, D12).

import type { PlaybookListItem } from "@/lib/playbooks"

export type GateMessage = { role: "system" | "user"; content: string }

export function buildGatePrompt(
  caseText: string,
  playbooks: PlaybookListItem[]
): GateMessage[] {
  const system =
    "You are a routing classifier for a customer-support copilot. " +
    "Given a support case and a list of playbooks (each with an id, a case type and aliases), " +
    "decide which single playbook, if any, clearly addresses the case's core issue. " +
    "If none clearly applies, return null — do NOT force a match. " +
    'Respond with ONLY a JSON object, no prose, no code fences: ' +
    '{"match": <playbook id string> | null, "confidence": <number between 0 and 1>, "reason": <short string>}.'

  const list = playbooks
    .map(
      (p) =>
        `- id: ${p.id} | case: ${p.caseType} | aliases: ${
          p.aliases.length ? p.aliases.join(", ") : "(none)"
        }`
    )
    .join("\n")

  const user = `Playbooks:\n${list}\n\nSupport case:\n${caseText}\n\nReturn the JSON verdict now.`

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

// Structured-output contract for the verdict. The gate used to lean on
// `temperature: 0` for a well-formed JSON object, which gpt-5.x rejects — the
// model now has to emit exactly this shape instead. `strict` mode requires every
// property listed in `required` and additionalProperties: false; a null match is
// expressed as a nullable type rather than an omitted field.
export const GATE_RESPONSE_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "playbook_gate_verdict",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["match", "confidence", "reason"],
      properties: {
        match: {
          type: ["string", "null"],
          description: "The id of the single playbook that clearly applies, or null if none does.",
        },
        confidence: { type: "number", description: "0 to 1." },
        reason: { type: "string", description: "Short justification." },
      },
    },
  },
}

export type PlaybookGateResult = {
  playbookId: string | null
  confidence: number
  reason: string
}

function clamp01(n: unknown): number {
  const x = typeof n === "number" ? n : Number(n)
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

export function parseGateResponse(
  content: string,
  playbookIds: string[]
): PlaybookGateResult {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()

  let raw: { match?: unknown; confidence?: unknown; reason?: unknown }
  try {
    raw = JSON.parse(cleaned)
  } catch {
    return { playbookId: null, confidence: 0, reason: "unparseable" }
  }

  const match = typeof raw.match === "string" && playbookIds.includes(raw.match) ? raw.match : null
  return {
    playbookId: match,
    confidence: clamp01(raw.confidence),
    reason: typeof raw.reason === "string" ? raw.reason : "",
  }
}

// Use the playbook only when the classifier is at least this confident.
// Below it → "no playbook applies" (the tail Phase 2 routes to Notion).
export const GATE_CONFIDENCE_THRESHOLD = 0.6

// Returns a verdict; on any failure returns reason "error" so callers can
// fall back to the keyword matcher and never regress on a model/API outage.
export async function classifyPlaybookMatch(
  caseText: string,
  playbooks: PlaybookListItem[]
): Promise<PlaybookGateResult> {
  // Dynamic imports keep the pure functions above free of the server-only
  // dependency chain (both modules below are server-only).
  const { withAiSlot, openaiFetch, openaiApiKey } = await import("@/lib/ai-throttle")
  const { getAuxDraftModel } = await import("@/lib/draft-ai")

  // Without the API key there's nothing to call — fall through to keyword match.
  if (!openaiApiKey() || playbooks.length === 0) {
    return { playbookId: null, confidence: 0, reason: "error" }
  }

  // Route through the shared-key throttle so the gate can't add to a 429
  // stampede alongside the generation/verifier/backfill calls.
  try {
    return await withAiSlot(async () => {
      const res = await openaiFetch("chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model: getAuxDraftModel(),
          // 512, not 200: a smoke test showed 200 truncated the JSON verdict
          // mid-"reason", which then parses as unparseable → a real match dropped.
          // Reasoning is off, so the whole budget goes to the visible JSON.
          max_completion_tokens: 512,
          reasoning_effort: "none",
          response_format: GATE_RESPONSE_SCHEMA,
          stream: false,
          messages: buildGatePrompt(caseText, playbooks),
        }),
      })
      if (!res.ok) return { playbookId: null, confidence: 0, reason: "error" }

      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[]
      }
      const content = data.choices?.[0]?.message?.content
      if (!content) return { playbookId: null, confidence: 0, reason: "error" }

      return parseGateResponse(
        content,
        playbooks.map((p) => p.id)
      )
    })
  } catch {
    return { playbookId: null, confidence: 0, reason: "error" }
  }
}
