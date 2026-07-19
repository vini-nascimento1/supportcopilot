// Inbox SLA staleness + one-click "send macro & close" quick actions.
//
// Client-safe (no server-only imports) — imported by components/canvas/inbox-panel.tsx.
//
// We aim to close a ticket within ~90 minutes. When a ticket has been sitting
// with the ball in the CUSTOMER's court (we replied last, nobody is waiting on
// us) we send a gentle "just checking in" nudge and close. This module is the
// pure logic + the exact macro text behind those quick actions.

export type SlaSeverity = "none" | "warn" | "urgent"

// Minutes of customer silence before each visual state kicks in.
export const SLA_WARN_MINUTES = 30
export const SLA_URGENT_MINUTES = 60

/**
 * True when the ball is in the CUSTOMER's court — we replied last and nobody is
 * waiting on us. This is the precondition for the "just checking in, we haven't
 * heard back from you" macro: sending it while WE owe a reply (waitingSince set)
 * would be wrong, so both the colouring and the check-in-&-close actions gate on
 * this. `waitingSince` non-null ⇒ waiting on us.
 */
export function isWaitingOnCustomer(
  waitingSince: string | null,
  lastAdminReplyAt: string | null
): boolean {
  if (waitingSince) return false
  return Boolean(lastAdminReplyAt)
}

/**
 * Staleness severity for an OPEN inbox row — but ONLY while we're waiting on the
 * customer (see isWaitingOnCustomer). Returns "none" when:
 *  - the clock hasn't hydrated yet (nowMs <= 0) — avoids a false red on first paint;
 *  - the ticket is waiting on US, or we never replied (isWaitingOnCustomer false).
 *
 * `waitingSince` and `lastAdminReplyAt` are ISO strings (or null).
 */
export function inboxSlaSeverity(
  waitingSince: string | null,
  lastAdminReplyAt: string | null,
  nowMs: number
): SlaSeverity {
  if (nowMs <= 0) return "none"
  if (!isWaitingOnCustomer(waitingSince, lastAdminReplyAt)) return "none"
  const repliedMs = Date.parse(lastAdminReplyAt as string)
  if (Number.isNaN(repliedMs)) return "none"
  const minutes = (nowMs - repliedMs) / 60_000
  if (minutes >= SLA_URGENT_MINUTES) return "urgent"
  if (minutes >= SLA_WARN_MINUTES) return "warn"
  return "none"
}

/** Whole minutes of customer silence since our last reply (for tooltips). 0 if unknown. */
export function customerSilentMinutes(lastAdminReplyAt: string | null, nowMs: number): number {
  if (nowMs <= 0 || !lastAdminReplyAt) return 0
  const repliedMs = Date.parse(lastAdminReplyAt)
  if (Number.isNaN(repliedMs)) return 0
  return Math.max(0, Math.floor((nowMs - repliedMs) / 60_000))
}

export type QuickMacro = {
  /** Button/label + popover heading. */
  label: string
  /** Plain-text preview shown in the confirm popover. */
  text: string
  /** HTML sent verbatim to Intercom (send with html: true). */
  html: string
}

// "No-reply check-in" macro — sent when a ticket has gone quiet on the
// customer's side. Verbatim team wording; sent as-is then the ticket is closed.
export const CHECKIN_MACRO: QuickMacro = {
  label: "Send check-in & close",
  text: "Hey, just checking in! We haven't heard back from you, but no worries at all.\n\nWhenever you're ready, feel free to reply here or start a new chat and we'll be happy to help.\n\nHave a great day! 😊",
  html: "<p>Hey, just checking in! We haven't heard back from you, but no worries at all.</p><p>Whenever you're ready, feel free to reply here or start a new chat and we'll be happy to help.</p><p>Have a great day! 😊</p>",
}

// "Review request" macro — sent on a happy/thankful ticket to invite a
// TrustPilot review, then closes. Verbatim team wording.
export const REVIEW_MACRO: QuickMacro = {
  label: "Send review request & close",
  text: "You're very welcome! If you feel I was able to help you, I would truly appreciate it if you could take a moment to leave a quick review on TrustPilot or Google. It would mean a lot to me!\n\nHere are the links if you'd like to share your feedback:\n\nTRUSTPILOT: https://uk.trustpilot.com/evaluate/fanvue.com\n\nThank you in advance — you're amazing!",
  html: '<p>You\'re very welcome! If you feel I was able to help you, I would truly appreciate it if you could take a moment to leave a quick review on TrustPilot or Google. It would mean a lot to me!</p><p>Here are the links if you\'d like to share your feedback:</p><p>TRUSTPILOT: <a href="https://uk.trustpilot.com/evaluate/fanvue.com" target="_blank" rel="noopener noreferrer">https://uk.trustpilot.com/evaluate/fanvue.com</a></p><p>Thank you in advance — you\'re amazing!</p>',
}
