// Shared header for every Home section: title on the left, count and a short
// breakdown on the right (mockup `.h-sec`), with an optional action (e.g.
// "Clear all") tucked between them.
export function SectionHeader({
  title,
  count,
  detail,
  action,
}: {
  title: string
  count?: number
  detail?: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-3">
      <h3 className="text-[13px] font-semibold tracking-tight">{title}</h3>
      <div className="flex min-w-0 items-baseline gap-2">
        {(count !== undefined || detail) && (
          <span className="truncate font-mono text-[11.5px] text-muted-foreground">
            {count !== undefined && <b className="font-semibold text-foreground">{count}</b>}
            {count !== undefined && detail ? " · " : count !== undefined ? "" : ""}
            {detail}
          </span>
        )}
        {action}
      </div>
    </div>
  )
}
