"use client"

import { useEffect, useState } from "react"

import { AttentionRow } from "@/components/home/attention-row"
import {
  ATTENTION_GROUP_LABEL,
  ATTENTION_GROUP_ORDER,
  attentionGroup,
  type AttentionItem,
} from "@/lib/briefing/types"

const LEAVE_MS = 220

// The "Needs you now" list. It renders every row the server sent and animates
// out the ones the board has marked dismissed — sent, rejected, opened, swiped,
// snoozed or X-ed. The dismissed set lives in the board because the hero tiles
// and the section header count off the same list; here it only drives the fade
// and collapse, and an Undo (an id leaving the set) puts the row straight back.
//
// Rows are then split into Reply / Answer / Decide, so a customer waiting, a
// colleague's question and a decision never sit in one undifferentiated pile.
// The split is derived from the items on every render, never stored, so the
// leave animation and Undo keep working exactly as before. With only one group
// in play there are no sub-headers: the section header already names the list.

export function AttentionList({
  items,
  dismissedIds,
  openId,
  onToggle,
  onDismiss,
  onSnooze,
  onHandled,
  downloadUrl,
  empty,
}: {
  items: AttentionItem[]
  dismissedIds: string[]
  openId: string | null
  onToggle: (id: string) => void
  onDismiss: (id: string) => void
  onSnooze: (id: string, until: string, label: string) => void
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

  const groups = ATTENTION_GROUP_ORDER.map((group) => ({
    group,
    rows: visible.filter((i) => attentionGroup(i) === group),
  })).filter((g) => g.rows.length > 0)

  const showHeaders = groups.length > 1

  return (
    <div>
      {groups.map(({ group, rows }) => (
        <div key={group} className={showHeaders ? "mt-3.5 first:mt-0" : undefined}>
          {showHeaders && (
            <div className="mb-1.5 flex items-baseline gap-2">
              <span className="text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
                {ATTENTION_GROUP_LABEL[group].title}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                {rows.length}
              </span>
              <span className="hidden truncate text-[11px] text-muted-foreground md:inline">
                {ATTENTION_GROUP_LABEL[group].hint}
              </span>
            </div>
          )}
          {rows.map((item) => {
            const leaving = dismissedIds.includes(item.id)
            return (
              <AttentionRow
                key={item.id}
                item={item}
                open={openId === item.id && !leaving}
                leaving={leaving}
                onToggle={() => onToggle(item.id)}
                onDismiss={onDismiss}
                onSnooze={onSnooze}
                onHandled={onHandled}
                downloadUrl={downloadUrl}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}
