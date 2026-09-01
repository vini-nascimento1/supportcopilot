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

/** How long the Undo action stays on screen. */
export const UNDO_MS = 5000

export type Dismiss = (ids: string[], message: string) => void

async function post(method: "POST" | "DELETE", ids: string[]): Promise<boolean> {
  const res = await fetch("/api/briefing/dismiss", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
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
    (ids, message) => {
      const batch = [...new Set(ids)].filter(Boolean)
      if (batch.length === 0) return

      setDismissedIds((prev) => [...new Set([...prev, ...batch])])
      void (async () => {
        if (!(await post("POST", batch))) {
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
