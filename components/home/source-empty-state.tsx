import Link from "next/link"
import { PlugZapIcon, TriangleAlertIcon } from "lucide-react"

import type { SourceStatus } from "@/lib/briefing/types"

// The three things a section can say when it has nothing to list: the source
// isn't connected, the source failed, or there is genuinely nothing new.

const LABEL: Record<SourceStatus["source"], string> = {
  intercom: "Intercom",
  slack: "Slack",
  gmail: "Gmail",
  calendar: "Calendar",
}

const WHAT: Record<SourceStatus["source"], string> = {
  intercom: "tickets waiting on you",
  slack: "mentions",
  gmail: "email worth your time",
  calendar: "today's schedule",
}

// Formatted in UK time on purpose: fixed on both server and client, so this
// never causes a hydration mismatch.
function formatSince(since: string | undefined): string | null {
  if (!since) return null
  const ms = Date.parse(since)
  if (Number.isNaN(ms)) return null
  const opts: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Europe/London",
  }
  const time = new Date(ms).toLocaleString("en-GB", opts)
  const day = new Date(ms).toLocaleDateString("en-GB", {
    weekday: "long",
    timeZone: "Europe/London",
  })
  return `${day} ${time}`
}

export function SourceEmptyState({
  status,
  since,
  okMessage,
}: {
  status: SourceStatus
  since?: string
  okMessage?: string
}) {
  const name = LABEL[status.source]

  if (status.state === "not_connected") {
    return (
      <div className="rounded-lg border border-dashed px-3.5 py-3 text-[12.5px] text-muted-foreground">
        <p className="flex items-center gap-2">
          <PlugZapIcon className="size-3.5 shrink-0" />
          Connect {name} to see {WHAT[status.source]} here.
        </p>
        <Link
          href="/settings"
          className="mt-1.5 inline-block font-medium text-foreground underline-offset-2 hover:underline"
        >
          Open Settings
        </Link>
      </div>
    )
  }

  if (status.state === "error") {
    return (
      <div className="rounded-lg border border-dashed px-3.5 py-3 text-[12.5px] text-muted-foreground">
        <p className="flex items-center gap-2">
          <TriangleAlertIcon className="size-3.5 shrink-0 text-foreground" />
          {status.message}
        </p>
      </div>
    )
  }

  const sinceLabel = formatSince(since)
  return (
    <div className="rounded-lg border border-dashed px-3.5 py-3 text-[12.5px] text-muted-foreground">
      {okMessage ?? (sinceLabel ? `Nothing new on ${name} since ${sinceLabel}.` : `Nothing new on ${name}.`)}
    </div>
  )
}
