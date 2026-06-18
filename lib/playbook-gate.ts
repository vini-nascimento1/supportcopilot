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
