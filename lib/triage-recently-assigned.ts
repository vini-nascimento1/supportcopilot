"use client"

// Client-side guard for the Triage panel: conversation ids the agent just
// claimed (single or bulk "Assign to me"). The server evicts them from the
// pool immediately (assign routes call removeTriageItems), but a poll already
// in flight — or the 45s poll firing a beat before the delete commits — can
// still return the stale row and make it "reappear". This short-lived local
// set filters those ids out of the ranked list until the server state is
// unambiguously caught up, then expires on its own.
//
// Mirrors lib/on-request-drafts.ts (same localStorage + event + TTL shape) so
// the two guards behave and are reasoned about identically.

const KEY = "fv-triage-recently-assigned"
const EVENT = "fv-triage-recently-assigned-changed"
// Long enough to outlast a poll racing the server delete (poll is 45s) plus a
// margin; short enough that if an assignment somehow bounced back to the pool
// (rare), the row returns quickly rather than being hidden for ages.
const TTL_MS = 90 * 1000

type Entry = { id: string; at: number }

function now() {
  return Date.now()
}

function read(): Entry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]")
    if (!Array.isArray(parsed)) return []
    const cutoff = now() - TTL_MS
    return parsed.filter(
      (e): e is Entry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as Entry).id === "string" &&
        typeof (e as Entry).at === "number" &&
        (e as Entry).at >= cutoff
    )
  } catch {
    return []
  }
}

function write(entries: Entry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries))
  } catch {
    // ignore storage failures
  }
  try {
    window.dispatchEvent(new Event(EVENT))
  } catch {
    // SSR / no window
  }
}

/** Mark ids as just-assigned so the panel hides them until the TTL expires. */
export function markRecentlyAssigned(ids: string[]) {
  if (ids.length === 0) return
  const at = now()
  const byId = new Map(read().map((e) => [e.id, e]))
  for (const id of ids) byId.set(id, { id, at })
  write([...byId.values()])
}

/** The set of still-fresh just-assigned ids (expired ones are dropped). */
export function readRecentlyAssigned(): Set<string> {
  return new Set(read().map((e) => e.id))
}

export function subscribeRecentlyAssigned(cb: () => void) {
  window.addEventListener(EVENT, cb)
  window.addEventListener("storage", cb)
  return () => {
    window.removeEventListener(EVENT, cb)
    window.removeEventListener("storage", cb)
  }
}
