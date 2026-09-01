import { SourceEmptyState } from "@/components/home/source-empty-state"
import { Badge } from "@/components/ui/badge"
import type { AttentionItem, SourceStatus } from "@/lib/briefing/types"

// "Worth your time in email": the unread threads that ask something of the
// agent, plus the ones worth knowing about. Nothing here is ever auto-replied.

function initials(title: string): string {
  const parts = title.trim().split(/\s+/).filter(Boolean)
  return (
    parts
      .slice(0, 2)
      .map((p) => p[0] ?? "")
      .join("")
      .toUpperCase() || "?"
  )
}

export function EmailDigest({
  items,
  status,
  since,
}: {
  items: AttentionItem[]
  status: SourceStatus
  since?: string
}) {
  if (items.length === 0) {
    return <SourceEmptyState status={status} since={since} />
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      {items.map((item) => (
        <a
          key={item.id}
          href={item.deepLink}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2.5 border-b px-3.5 py-2.5 transition-colors last:border-b-0 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span
            aria-hidden
            className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-xs font-semibold"
          >
            {initials(item.title)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-semibold">{item.title}</span>
            <span className="mt-px block truncate text-[11.5px] text-muted-foreground">
              {item.context}
            </span>
          </span>
          {item.kind === "email_action" ? (
            <Badge className="shrink-0 bg-amber-500/12 text-amber-700 dark:text-amber-400">
              action
            </Badge>
          ) : (
            <Badge variant="outline" className="shrink-0">
              fyi
            </Badge>
          )}
        </a>
      ))}
    </div>
  )
}
