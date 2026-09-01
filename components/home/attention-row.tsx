"use client"

import { ChevronRightIcon, SparklesIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { PreparedCard } from "@/components/home/prepared-card"
import { cn } from "@/lib/utils"
import type { AttentionItem, AttentionKind } from "@/lib/briefing/types"

// One row in "Needs you now": urgency bar, source chip, when, title, context,
// and a line saying what the copilot already did. Clicking the row expands the
// prepared work inline (one row open at a time — the list owns that state).

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

export function AttentionRow({
  item,
  open,
  leaving,
  onToggle,
  onResolved,
  downloadUrl,
}: {
  item: AttentionItem
  open: boolean
  leaving: boolean
  onToggle: () => void
  onResolved: (id: string) => void
  downloadUrl?: string
}) {
  const panelId = `home-row-${item.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`
  const urgent = item.urgency === "now"

  return (
    <div
      data-home-item={item.id}
      className={cn(
        "grid transition-all duration-200 motion-reduce:transition-none",
        leaving ? "scale-[0.99] grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
      )}
    >
      <div className="min-h-0 overflow-hidden">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="mb-2 flex w-full cursor-pointer gap-3 rounded-lg border bg-card py-3 pr-3 text-left transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span
            aria-hidden
            className={cn(
              "-ml-px w-[3px] shrink-0 self-stretch rounded-r-[3px]",
              urgent ? "bg-destructive" : item.urgency === "today" ? "bg-amber-500" : "bg-border",
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="mb-1 flex items-center gap-2">
              <Badge variant="outline" className="font-semibold">
                {kindChipLabel(item.kind)}
              </Badge>
              <span
                className={cn(
                  "ml-auto shrink-0 font-mono text-[11px] tabular-nums",
                  urgent ? "text-destructive" : "text-muted-foreground",
                )}
              >
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
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 self-center text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
              open && "rotate-90",
            )}
          />
        </button>

        {open && (
          <div id={panelId} className="mb-3 overflow-hidden rounded-lg border bg-card">
            <div className="border-b px-3.5 py-3">
              <p className="mb-1 text-[11px] font-semibold text-muted-foreground">
                {kindChipLabel(item.kind)} · {item.whenLabel}
              </p>
              <p className="text-[13px] leading-relaxed">{item.context}</p>
            </div>
            <PreparedCard item={item} onResolved={onResolved} downloadUrl={downloadUrl} />
          </div>
        )}
      </div>
    </div>
  )
}
