"use client"

import { useCallback, useState } from "react"
import { toast } from "sonner"

// Client half of the Home dismissal feature. The server filters dismissed ids
// out of every list at read time (lib/briefing/build.ts::applyDismissals); this
// hook makes the same thing happen instantly, before the round trip, and keeps
// an Undo within reach for a few seconds.
//
// Optimistic on purpose: the row leaves the moment the agent asks it to, and a
// failed POST puts it straight back with an error toast rather than leaving the
// UI and the database disagreeing.
//
// A snooze is the same call with `until` set: the server keeps the dismissal
// only until that timestamp, then the item comes back on its own. Undo is a
// DELETE either way, which also un-snoozes.

/** How long the Undo action stays on screen. */
export const UNDO_MS = 5000

export type DismissOptions = {
  /** "acted" = the agent handled it here; "manual" = an explicit X / swipe. */
  reason?: "manual" | "acted"
  /** ISO timestamp in the future — turns the dismissal into a snooze. */
  until?: string
}

export type Dismiss = (ids: string[], message: string, opts?: DismissOptions) => void

async function post(
  method: "POST" | "DELETE",
  ids: string[],
  opts?: DismissOptions,
): Promise<boolean> {
  const res = await fetch("/api/briefing/dismiss", {
    method,
    headers: { "Content-Type": "application/json" },
    // DELETE only ever restores; the reason/until belong to the POST.
    body: JSON.stringify(
      method === "POST" ? { ids, reason: opts?.reason, until: opts?.until } : { ids },
    ),
  }).catch(() => null)
  return Boolean(res?.ok)
}

export function useDismissals(): { dismissedIds: string[]; dismiss: Dismiss } {
  const [dismissedIds, setDismissedIds] = useState<string[]>([])

  const undo = useCallback(async (ids: string[]) => {
    setDismissedIds((prev) => prev.filter((id) => !ids.includes(id)))
    if (!(await post("DELETE", ids))) {
      toast.error("Couldn't undo that. It will come back on the next refresh.")
    }
  }, [])

  const dismiss = useCallback<Dismiss>(
    (ids, message, opts) => {
      const batch = [...new Set(ids)].filter(Boolean)
      if (batch.length === 0) return

      setDismissedIds((prev) => [...new Set([...prev, ...batch])])
      void (async () => {
        if (!(await post("POST", batch, opts))) {
          setDismissedIds((prev) => prev.filter((id) => !batch.includes(id)))
          toast.error("Couldn't clear that from Home. Try again.")
          return
        }
        toast(message, {
          duration: UNDO_MS,
          action: { label: "Undo", onClick: () => void undo(batch) },
        })
      })()
    },
    [undo],
  )

  return { dismissedIds, dismiss }
}
