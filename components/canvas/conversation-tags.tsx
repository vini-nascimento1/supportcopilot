"use client"

import {
  TAG_TONE_CLASS,
  formatTagLabel,
  sortTagsForDisplay,
  tagTone,
} from "@/lib/conversation-tags"
import { cn } from "@/lib/utils"

// The Intercom tags of one conversation, as a row of tiny badges. Shared by
// the Inbox and Triage panels so a ticket looks the same wherever it shows up
// — an agent scanning either list can tell an AGENCY ticket from a FAN one
// without opening it.
//
// Rows are narrow (the canvas sidebar has to survive a 1366×768 laptop), so
// only the first `max` tags render; the rest collapse into a "+N" whose title
// lists them. Raw tag names stay available on hover.
export function ConversationTags({
  tags,
  max = 3,
  className,
}: {
  tags: readonly string[]
  max?: number
  className?: string
}) {
  const sorted = sortTagsForDisplay(tags)
  if (sorted.length === 0) return null

  const shown = sorted.slice(0, max)
  const hidden = sorted.slice(max)

  return (
    <span className={cn("flex flex-wrap items-center gap-1", className)}>
      {shown.map((tag) => (
        <span
          key={tag}
          title={tag}
          className={cn(
            "rounded border px-1 py-px text-[9px] font-medium uppercase leading-[14px] tracking-wide",
            TAG_TONE_CLASS[tagTone(tag)]
          )}
        >
          {formatTagLabel(tag)}
        </span>
      ))}
      {hidden.length > 0 && (
        <span title={hidden.join(", ")} className="text-[9px] text-muted-foreground">
          +{hidden.length}
        </span>
      )}
    </span>
  )
}
