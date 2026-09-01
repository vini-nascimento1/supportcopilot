import type { AttentionItem, BriefingCounts } from "@/lib/briefing/types"

// The deterministic hero sentence, split out of narrative.ts so it has no
// server-only dependency. Two callers need exactly the same wording:
//
//   • the server, when the model narrative is unavailable or unusable, and
//     when dismissed items have changed the shape of the briefing after the
//     model already wrote about it (lib/briefing/build.ts::applyDismissals);
//   • the client, after the agent dismisses rows on Home — the hero must never
//     keep claiming three drafts while the list shows one.
//
// Pure counting, no I/O, no model. Safe to import from a client component.

const KIND_NOUNS: Record<AttentionItem["kind"], [string, string]> = {
  ticket_awaiting_reply: ["ticket waiting on a reply", "tickets waiting on a reply"],
  slack_mention: ["Slack mention", "Slack mentions"],
  slack_dm: ["Slack DM", "Slack DMs"],
  slack_thread_reply: ["thread reply", "thread replies"],
  email_action: ["email that needs you", "emails that need you"],
  email_fyi: ["email to skim", "emails to skim"],
  calendar_event: ["thing on your calendar", "things on your calendar"],
}

function plural(kind: AttentionItem["kind"], n: number): string {
  const [one, many] = KIND_NOUNS[kind]
  return `${n} ${n === 1 ? one : many}`
}

function joinList(parts: string[]): string {
  if (parts.length === 0) return ""
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
}

/**
 * Deterministic narrative from counts alone. This is the fallback AND the
 * safety net: it is what the agent sees whenever the model is unavailable,
 * slow, returns something we won't accept, or has been overtaken by a
 * dismissal.
 */
export function buildFallbackNarrative(
  items: AttentionItem[],
  counts: BriefingCounts
): string {
  if (items.length === 0) {
    return "Nothing needs you right now. Your queue, Slack and inbox are all clear."
  }

  const byKind = new Map<AttentionItem["kind"], number>()
  for (const item of items) byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + 1)

  const order: AttentionItem["kind"][] = [
    "ticket_awaiting_reply",
    "slack_dm",
    "slack_mention",
    "email_action",
    "calendar_event",
    "email_fyi",
    "slack_thread_reply",
  ]
  const parts = order
    .filter((kind) => (byKind.get(kind) ?? 0) > 0)
    .slice(0, 3)
    .map((kind) => plural(kind, byKind.get(kind) as number))

  const opener = `While you were away, ${joinList(parts)} came in.`

  const prepared: string[] = []
  if (counts.drafted > 0) prepared.push(`${counts.drafted} repl${counts.drafted === 1 ? "y is" : "ies are"} drafted`)
  if (counts.researched > 0) prepared.push(`${counts.researched} answer${counts.researched === 1 ? " is" : "s are"} researched`)
  if (prepared.length === 0) return opener

  const locked =
    counts.locked > 0
      ? ` ${counts.locked} need${counts.locked === 1 ? "s" : ""} a fadmin check before it can go out.`
      : ""

  return `${opener} ${joinList(prepared)} and waiting for your review.${locked}`
}
