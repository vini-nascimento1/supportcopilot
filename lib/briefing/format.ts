// Pure formatting helpers for the Home briefing. No I/O, no `server-only`, so
// every label the UI renders verbatim is unit-tested here rather than
// re-derived on the client (the contract in lib/briefing/types.ts says
// whenLabel is computed server-side so the client needs no clock logic).
//
// Also holds the sanitizers every source runs its title/context through:
// briefing text ends up in an AI prompt and in the UI, so email addresses and
// control characters are stripped at the boundary, once.

import { validTimezone } from "@/lib/timezones"
import { LOCKED_CATEGORIES, type RiskBand } from "@/lib/reply-queue"

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** Longest a title/context line may be before it is cut. */
export const MAX_TITLE_CHARS = 80
export const MAX_CONTEXT_CHARS = 160

function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

/** "26 min", "2h 10m", "3d" — the shared duration core of every label below. */
export function formatDuration(ms: number): string {
  const abs = Math.max(0, ms)
  if (abs < MINUTE_MS) return "<1 min"
  if (abs < HOUR_MS) return `${Math.floor(abs / MINUTE_MS)} min`
  if (abs < DAY_MS) {
    const hours = Math.floor(abs / HOUR_MS)
    const minutes = Math.floor((abs % HOUR_MS) / MINUTE_MS)
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  }
  const days = Math.floor(abs / DAY_MS)
  return `${days}d`
}

/** Intercom tickets: "Waiting 26 min" from `waiting_since`. */
export function waitingLabel(sinceIso: string | null | undefined, nowMs: number): string {
  const since = parseMs(sinceIso)
  if (since === null) return "Waiting on us"
  return `Waiting ${formatDuration(nowMs - since)}`
}

/** Slack / Gmail: "just now", "26 min ago", "2h ago". */
export function agoLabel(iso: string | null | undefined, nowMs: number): string {
  const at = parseMs(iso)
  if (at === null) return "recently"
  const delta = nowMs - at
  if (delta < MINUTE_MS) return "just now"
  return `${formatDuration(delta)} ago`
}

/**
 * Calendar: "in 48 min" while the event is inside the hour, the wall-clock time
 * ("at 14:30", in the agent's timezone) further out, and a past-tense label once
 * it has started — the mockup's day timeline reads top-to-bottom through "now".
 */
export function untilLabel(
  startIso: string | null | undefined,
  nowMs: number,
  timeZone?: string | null
): string {
  const start = parseMs(startIso)
  if (start === null) return "Today"
  const delta = start - nowMs
  if (delta < 0) return `started ${formatDuration(-delta)} ago`
  if (delta < HOUR_MS) return `in ${formatDuration(delta)}`
  return `at ${formatClockTime(startIso as string, timeZone)}`
}

/** "14:30" in the agent's timezone (UK fallback, same as the rest of the app). */
export function formatClockTime(iso: string, timeZone?: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: validTimezone(timeZone),
    }).format(new Date(iso))
  } catch {
    return iso.slice(11, 16)
  }
}

// ── Sanitizers ──────────────────────────────────────────────────────────────

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

// Unicode "Control" category — C0 and C1 in one escape, so this file carries no
// literal control characters of its own.
const CONTROL_RE = /\p{Cc}/gu

/**
 * Titles and contexts are built from provider text (a Slack message, an email
 * subject, an Intercom snippet). Two things must never survive that trip: an
 * email address (the contract says "never emails or full names") and layout
 * characters that would let one item's text impersonate another line of the
 * prompt the narrative model reads.
 */
export function sanitizeLine(raw: string | null | undefined, maxChars: number): string {
  if (!raw) return ""
  return raw
    .replace(EMAIL_RE, "[email]")
    // Collapse every whitespace run — including the newlines an injected
    // "\n\nSystem:" prefix would rely on — to a single space.
    .replace(/\s+/g, " ")
    .replace(CONTROL_RE, "")
    .trim()
    .slice(0, maxChars)
    .trim()
}

/** First name only — the contract allows first names in titles, nothing more. */
export function firstNameOf(raw: string | null | undefined, fallback = "a colleague"): string {
  const cleaned = sanitizeLine(raw, MAX_TITLE_CHARS)
  if (!cleaned) return fallback
  // A display name that is really an email address carries no usable first name.
  if (cleaned.includes("[email]")) return fallback
  const first = cleaned.split(" ")[0]?.replace(/[,:;]$/, "") ?? ""
  return first || fallback
}

// ── Send-lock copy ──────────────────────────────────────────────────────────

// Mirrors the Canvas queue panel's lock copy so the same draft reads the same
// way on Home (components/canvas/queue-panel.tsx: "Verify payout / KYC / media
// in fadmin before sending."). Do not reword one without the other.
export const LOCK_REASON_GENERIC = "Verify payout / KYC / media in fadmin before sending."
export const LOCK_REASON_MANUAL_ACTION =
  "This one needs a manual step in fadmin first — verify before sending."

/** Human label for a matched locked category. */
const CATEGORY_LABELS: Record<string, string> = {
  payout: "the payout",
  masspay: "the MassPay payout",
  triplea: "the TripleA payout",
  financial: "the charge",
  kyc: "KYC",
  media: "the media",
  ban: "the ban",
  moderation: "the moderation record",
  compliance: "the compliance record",
}

/** Which locked category (if any) a conversation's tags match. Pure. */
export function matchLockedCategory(
  tags: readonly string[] | null | undefined
): (typeof LOCKED_CATEGORIES)[number] | null {
  if (!tags) return null
  for (const raw of tags) {
    const tag = String(raw).toLowerCase()
    const hit = LOCKED_CATEGORIES.find((cat) => tag.includes(cat))
    if (hit) return hit
  }
  return null
}

/**
 * `lockReason` for a `needs_check` draft. Only that band locks the send
 * (lib/reply-queue.ts::isSendLocked), so every other band returns undefined and
 * the UI shows no banner at all.
 */
export function deriveLockReason(input: {
  band: RiskBand
  tags?: readonly string[] | null
  requiresManualAction?: boolean
}): string | undefined {
  if (input.band !== "needs_check") return undefined
  if (input.requiresManualAction) return LOCK_REASON_MANUAL_ACTION
  const category = matchLockedCategory(input.tags)
  if (!category) return LOCK_REASON_GENERIC
  return `Verify ${CATEGORY_LABELS[category] ?? category} in fadmin before sending.`
}
