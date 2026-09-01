import { SourceEmptyState } from "@/components/home/source-empty-state"
import { cn } from "@/lib/utils"
import type { AttentionItem, SourceStatus } from "@/lib/briefing/types"

// Today's calendar, in the right column. The next event inside the hour gets
// the "soon" dot; everything else is calm.
export function DayTimeline({
  events,
  status,
  nowMs,
}: {
  events: AttentionItem[]
  status: SourceStatus
  nowMs: number
}) {
  if (events.length === 0) {
    return <SourceEmptyState status={status} okMessage="Nothing in the calendar today." />
  }

  return (
    <div className="rounded-lg border bg-card px-3.5">
      {events.map((event) => {
        const startsIn = event.dueAt ? Date.parse(event.dueAt) - nowMs : Number.NaN
        const soon = !Number.isNaN(startsIn) && startsIn >= 0 && startsIn < 60 * 60 * 1000
        return (
          <div
            key={event.id}
            className="flex gap-3 border-b py-2.5 last:border-b-0"
          >
            <span className="w-15 shrink-0 pt-px font-mono text-[11.5px] leading-tight font-medium tabular-nums">
              {event.whenLabel}
            </span>
            <span
              aria-hidden
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                soon ? "bg-destructive ring-3 ring-destructive/15" : "bg-muted-foreground",
              )}
            />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold">{event.title}</span>
              <span className="mt-px block truncate text-[11.5px] text-muted-foreground">
                {event.context}
              </span>
            </span>
          </div>
        )
      })}
    </div>
  )
}
