// Snooze options for Home rows. Pure, no React, no server-only: the same
// function runs in the browser (the menu) and in tests. Everything is computed
// in the machine's LOCAL time, because "tomorrow morning" means the agent's
// morning, not UTC's.
//
// A snooze is a dismissal with an expiry: the client posts the resolved
// `until` to /api/briefing/dismiss and the item comes back on its own once that
// timestamp passes. Nothing here talks to the API; it only decides the times.

export type SnoozeKey = "later_today" | "tomorrow" | "next_monday" | "next_week"

export type SnoozeOption = {
  key: SnoozeKey
  /** Short menu label, e.g. "Tomorrow 9:00". */
  label: string
  /** Resolved local wall-clock time the item comes back. */
  until: Date
}

const HOUR_MS = 60 * 60 * 1000

/** "Later today" pushes the row this far out. */
const LATER_TODAY_HOURS = 3
/** …but only while that still lands before the end of the working evening. */
const LATER_TODAY_CUTOFF_HOUR = 19
/** Every day-level snooze returns at the start of the working day. */
const MORNING_HOUR = 9

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const

/** Local midnight-anchored date `dayOffset` days from `base`, at `hour`:00. */
function atHour(base: Date, dayOffset: number, hour: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, hour, 0, 0, 0)
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** "9:00" — no leading zero, the way a person says it. */
function clock(d: Date): string {
  return `${d.getHours()}:${pad2(d.getMinutes())}`
}

/** "09:00" — padded, for the aligned mono column in the menu. */
function paddedClock(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/**
 * The snooze menu, in order. Always 2 or 3 entries:
 *
 *  - "Later today" (now + 3h) only while that stays before 19:00 today, so a
 *    late-evening snooze never resolves in the middle of the night.
 *  - "Tomorrow 9:00".
 *  - The next Monday 9:00 — unless tomorrow already IS that Monday, in which
 *    case the third option would duplicate the second, so it becomes the Monday
 *    after ("Next week").
 */
export function snoozeOptions(now: Date): SnoozeOption[] {
  const options: SnoozeOption[] = []

  const later = new Date(now.getTime() + LATER_TODAY_HOURS * HOUR_MS)
  if (later.getTime() < atHour(now, 0, LATER_TODAY_CUTOFF_HOUR).getTime()) {
    options.push({ key: "later_today", label: "Later today", until: later })
  }

  const tomorrow = atHour(now, 1, MORNING_HOUR)
  options.push({ key: "tomorrow", label: `Tomorrow ${clock(tomorrow)}`, until: tomorrow })

  // Strictly future: on a Monday, "next Monday" is seven days out, not today.
  const daysToMonday = (1 - now.getDay() + 7) % 7 || 7
  if (daysToMonday === 1) {
    const nextWeek = atHour(now, 8, MORNING_HOUR)
    options.push({ key: "next_week", label: "Next week", until: nextWeek })
  } else {
    const monday = atHour(now, daysToMonday, MORNING_HOUR)
    options.push({ key: "next_monday", label: `Mon ${clock(monday)}`, until: monday })
  }

  return options
}

/**
 * The muted right-hand column in the menu: the time the option actually
 * resolves to. Same day drops the weekday, everything else keeps it, so
 * "Tomorrow 9:00" still tells you which day that is.
 */
export function snoozeAtLabel(until: Date, now: Date): string {
  if (sameLocalDay(until, now)) return paddedClock(until)
  return `${WEEKDAY_SHORT[until.getDay()]} ${paddedClock(until)}`
}

/** Toast text: "Snoozed until <this>". Lowercase, reads as a sentence. */
export function snoozeToastLabel(until: Date, now: Date): string {
  if (sameLocalDay(until, now)) return "later today"
  if (sameLocalDay(until, atHour(now, 1, 0))) return `tomorrow ${clock(until)}`
  return `${WEEKDAY_SHORT[until.getDay()]} ${clock(until)}`
}
