"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { AttentionRow } from "@/components/home/attention-row"
import type { AttentionItem } from "@/lib/briefing/types"

const LEAVE_MS = 220

// The "Needs you now" list. Owns the fade+collapse of a row that has just been
// sent, answered or dismissed; the open row is controlled by the parent so the
// hero tiles can jump straight to an item.
export function AttentionList({
  items,
  openId,
  onToggle,
  downloadUrl,
  empty,
}: {
  items: AttentionItem[]
  openId: string | null
  onToggle: (id: string) => void
  downloadUrl?: string
  empty?: React.ReactNode
}) {
  const [leaving, setLeaving] = useState<string[]>([])
  const [gone, setGone] = useState<string[]>([])
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  const onResolved = useCallback((id: string) => {
    setLeaving((prev) => (prev.includes(id) ? prev : [...prev, id]))
    timers.current.push(
      setTimeout(() => setGone((prev) => (prev.includes(id) ? prev : [...prev, id])), LEAVE_MS),
    )
  }, [])

  const visible = items.filter((i) => !gone.includes(i.id))

  if (visible.length === 0) {
    return <>{empty ?? null}</>
  }

  return (
    <div>
      {visible.map((item) => (
        <AttentionRow
          key={item.id}
          item={item}
          open={openId === item.id && !leaving.includes(item.id)}
          leaving={leaving.includes(item.id)}
          onToggle={() => onToggle(item.id)}
          onResolved={onResolved}
          downloadUrl={downloadUrl}
        />
      ))}
    </div>
  )
}
