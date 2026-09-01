"use client"

import { useEffect, useState } from "react"

import { AttentionRow } from "@/components/home/attention-row"
import type { AttentionItem } from "@/lib/briefing/types"

const LEAVE_MS = 220

// The "Needs you now" list. It renders every row the server sent and animates
// out the ones the board has marked dismissed — sent, rejected, opened, swiped
// or X-ed. The dismissed set lives in the board because the hero tiles and the
// section header count off the same list; here it only drives the fade and
// collapse, and an Undo (an id leaving the set) puts the row straight back.
export function AttentionList({
  items,
  dismissedIds,
  openId,
  onToggle,
  onDismiss,
  onHandled,
  downloadUrl,
  empty,
}: {
  items: AttentionItem[]
  dismissedIds: string[]
  openId: string | null
  onToggle: (id: string) => void
  onDismiss: (id: string) => void
  onHandled: (id: string) => void
  downloadUrl?: string
  empty?: React.ReactNode
}) {
  // `gone` = rows whose leave animation has finished and can drop out of the
  // layout. It is only ever written from a timer (never synchronously in the
  // effect), and re-derived against dismissedIds at render so an Undo restores
  // the row on the same frame instead of waiting for the timer.
  const [gone, setGone] = useState<string[]>([])

  useEffect(() => {
    const timer = setTimeout(
      () => setGone([...dismissedIds]),
      dismissedIds.length === 0 ? 0 : LEAVE_MS,
    )
    return () => clearTimeout(timer)
  }, [dismissedIds])

  const hidden = gone.filter((id) => dismissedIds.includes(id))
  const visible = items.filter((i) => !hidden.includes(i.id))

  if (visible.length === 0) {
    return <>{empty ?? null}</>
  }

  return (
    <div>
      {visible.map((item) => {
        const leaving = dismissedIds.includes(item.id)
        return (
          <AttentionRow
            key={item.id}
            item={item}
            open={openId === item.id && !leaving}
            leaving={leaving}
            onToggle={() => onToggle(item.id)}
            onDismiss={onDismiss}
            onHandled={onHandled}
            downloadUrl={downloadUrl}
          />
        )
      })}
    </div>
  )
}
