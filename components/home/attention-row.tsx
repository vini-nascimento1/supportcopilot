"use client"

import { useCallback, useRef, useState } from "react"
import {
  CalendarIcon,
  ChevronRightIcon,
  MailIcon,
  MessageSquareIcon,
  SparklesIcon,
  TicketIcon,
  XIcon,
} from "lucide-react"

import { Tag } from "@/components/ui/status-tag"
import { PreparedCard } from "@/components/home/prepared-card"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import type { AttentionItem, AttentionKind } from "@/lib/briefing/types"

// One row in "Needs you now": urgency bar, source chip, when, title, context,
// and a line saying what the copilot already did. Clicking the row expands the
// prepared work inline (one row open at a time — the list owns that state).
//
// Dismissing: an X in the top-right on pointer devices, a left swipe on a
// phone. Both mean the same thing — "I have handled this" — and both go
// through the list's onDismiss, which posts to /api/briefing/dismiss and offers
// an Undo. Acting on the row (sending, rejecting, opening the deep link) counts
// as handling it too; that comes back up from PreparedCard.

const KIND_CHIP: Record<AttentionKind, string> = {
  ticket_awaiting_reply: "Ticket",
  slack_mention: "Mention",
  slack_dm: "DM",
  slack_thread_reply: "Thread",
  email_action: "Email",
  email_fyi: "Email",
  calendar_event: "Event",
}

export function kindChipLabel(kind: AttentionKind): string {
  return KIND_CHIP[kind] ?? "Item"
}

const KIND_ICON: Record<AttentionKind, React.ComponentType<{ className?: string }>> = {
  ticket_awaiting_reply: TicketIcon,
  slack_mention: MessageSquareIcon,
  slack_dm: MessageSquareIcon,
  slack_thread_reply: MessageSquareIcon,
  email_action: MailIcon,
  email_fyi: MailIcon,
  calendar_event: CalendarIcon,
}

/** Fraction of the row width a swipe must cross to commit. */
const SWIPE_COMMIT_RATIO = 0.35
/** …or this much speed, in px per millisecond, for a short flick. */
const SWIPE_COMMIT_VELOCITY = 0.5
/** Horizontal travel before the gesture takes over from vertical scrolling. */
const SWIPE_AXIS_LOCK_PX = 10

/** The "what I did" line under the context. */
export function preparedSummaryLine(item: AttentionItem): string {
  const prepared = item.prepared
  if (!prepared) {
    return item.pending ? "Looking this one up…" : "Nothing prepared — open it at the source"
  }
  if (prepared.kind === "draft") {
    if (prepared.band === "needs_check") return "Reply drafted · Locked until you check fadmin"
    if (prepared.band === "low_confidence") return "Reply drafted · Review it carefully"
    return "Reply drafted · Ready to send"
  }
  if (prepared.kind === "answer") {
    const n = prepared.sources.length
    return n > 0 ? `Researched · answer drafted from ${n} sources` : "Answer suggested · you edit, you send"
  }
  return "Summarised · needs a decision from you"
}

type Gesture = {
  x: number
  y: number
  t: number
  width: number
  axis: "x" | "y" | null
}

export function AttentionRow({
  item,
  open,
  leaving,
  onToggle,
  onDismiss,
  onHandled,
  downloadUrl,
}: {
  item: AttentionItem
  open: boolean
  leaving: boolean
  onToggle: () => void
  /** Explicit "I don't need this" — the X button or a left swipe. */
  onDismiss: (id: string) => void
  /** The agent acted on it (sent, rejected, opened it at the source). */
  onHandled: (id: string) => void
  downloadUrl?: string
}) {
  const panelId = `home-row-${item.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`
  const urgent = item.urgency === "now"
  const KindIcon = KIND_ICON[item.kind] ?? SparklesIcon

  const isMobile = useIsMobile()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const swallowClick = useRef(false)
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)

  const endGesture = useCallback(() => {
    gesture.current = null
    setDragging(false)
    setOffset(0)
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Swipe is the phone affordance; pointer devices get the X button.
      if (!isMobile || e.pointerType === "mouse") return
      gesture.current = {
        x: e.clientX,
        y: e.clientY,
        t: e.timeStamp,
        width: surfaceRef.current?.offsetWidth || 320,
        axis: null,
      }
    },
    [isMobile],
  )

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const g = gesture.current
    if (!g) return
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y

    if (g.axis === null) {
      // Vertical scrolling always wins: the horizontal gesture only starts once
      // the finger is clearly going left.
      if (Math.abs(dy) > Math.abs(dx)) {
        if (Math.abs(dy) > SWIPE_AXIS_LOCK_PX) g.axis = "y"
        return
      }
      if (dx > -SWIPE_AXIS_LOCK_PX) return
      g.axis = "x"
      setDragging(true)
      try {
        surfaceRef.current?.setPointerCapture(e.pointerId)
      } catch {
        // Capture is a nicety; the gesture still tracks without it.
      }
    }
    if (g.axis !== "x") return
    setOffset(Math.min(0, dx))
  }, [])

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const g = gesture.current
      if (!g || g.axis !== "x") {
        endGesture()
        return
      }
      const travelled = Math.abs(offset)
      const velocity = travelled / Math.max(1, e.timeStamp - g.t)
      const commit =
        travelled > g.width * SWIPE_COMMIT_RATIO || velocity > SWIPE_COMMIT_VELOCITY
      // A swipe must never also count as a tap on the row.
      swallowClick.current = travelled > 6
      endGesture()
      if (commit) onDismiss(item.id)
    },
    [endGesture, item.id, offset, onDismiss],
  )

  const handleToggle = useCallback(() => {
    if (swallowClick.current) {
      swallowClick.current = false
      return
    }
    onToggle()
  }, [onToggle])

  return (
    <div
      data-home-item={item.id}
      className={cn(
        "grid transition-all duration-200 motion-reduce:transition-none",
        leaving ? "scale-[0.99] grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
      )}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          ref={surfaceRef}
          className="group/row relative mb-2 overflow-hidden rounded-lg"
          style={{ touchAction: "pan-y" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={endGesture}
        >
          {/* Revealed by a left swipe on a phone. Neutral, no colour. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 flex items-center rounded-lg bg-muted pr-4 pl-8 text-[11.5px] font-semibold text-muted-foreground"
          >
            Dismiss
          </span>

          <div
            className={cn(
              "relative",
              !dragging && "transition-transform duration-200 motion-reduce:transition-none",
            )}
            style={offset ? { transform: `translateX(${offset}px)` } : undefined}
          >
            <button
              type="button"
              onClick={handleToggle}
              aria-expanded={open}
              aria-controls={panelId}
              className="flex w-full cursor-pointer gap-3 rounded-lg border bg-card py-3 pr-10 text-left transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <span
                aria-hidden
                className={cn(
                  "-ml-px w-[3px] shrink-0 self-stretch rounded-r-[3px]",
                  urgent ? "bg-destructive" : "bg-border",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="mb-1 flex items-center gap-2">
                  <Tag>
                    <KindIcon />
                    {kindChipLabel(item.kind)}
                  </Tag>
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                    {item.whenLabel}
                  </span>
                </span>
                <span className="block text-[13.5px] font-semibold tracking-tight">{item.title}</span>
                <span
                  className={cn(
                    "mt-0.5 block text-[12.5px] text-muted-foreground",
                    open ? "whitespace-normal" : "truncate",
                  )}
                >
                  {item.context}
                </span>
                <span className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                  <SparklesIcon className="size-3 shrink-0" />
                  {preparedSummaryLine(item)}
                </span>
              </span>
            </button>

            {/* Pointer devices: an X that appears on hover or keyboard focus. */}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={(e) => {
                e.stopPropagation()
                onDismiss(item.id)
              }}
              className="absolute top-2 right-2 hidden size-6 cursor-pointer place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none group-hover/row:opacity-100 md:grid"
            >
              <XIcon className="size-3.5" />
            </button>

            <ChevronRightIcon
              aria-hidden
              className={cn(
                "pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
                open && "rotate-90",
              )}
            />
          </div>
        </div>

        {open && (
          <div id={panelId} className="mb-3 overflow-hidden rounded-lg border bg-card">
            <div className="border-b px-3.5 py-3">
              <p className="mb-1 text-[11px] font-semibold text-muted-foreground">
                {kindChipLabel(item.kind)} · {item.whenLabel}
              </p>
              <p className="text-[13px] leading-relaxed">{item.context}</p>
            </div>
            <PreparedCard item={item} onHandled={onHandled} downloadUrl={downloadUrl} />
          </div>
        )}
      </div>
    </div>
  )
}
