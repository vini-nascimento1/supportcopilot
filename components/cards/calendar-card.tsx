import { CalendarIcon, ExternalLinkIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { CalendarRangeTabs } from "@/components/calendar-range-tabs"
import {
  ConnectedStatus,
  LoadErrorBody,
  LoadErrorStatus,
  NotConnectedStatus,
} from "@/components/cards/connection-status"
import { CalendarEventTime } from "@/components/cards/calendar-event-time"
import type { GCalResult, CalendarEvent, CalRange } from "@/lib/gcal"

function formatEventTime(iso: string | null, isAllDay: boolean): string {
  if (!iso) return ""
  if (isAllDay) return "All day"
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
}

function eventDuration(start: string | null, end: string | null): string {
  if (!start || !end) return ""
  const mins = (new Date(end).getTime() - new Date(start).getTime()) / 60000
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function isHappeningNow(event: CalendarEvent, nowIso: string): boolean {
  if (!event.start || !event.end || event.isAllDay) return false
  const now = new Date(nowIso).getTime()
  return new Date(event.start).getTime() <= now && now <= new Date(event.end).getTime()
}

const RANGE_LABELS: Record<CalRange, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
}

function formatDayHeader(dateLabel: string): string {
  return new Date(dateLabel + "T12:00:00").toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short",
  })
}

function groupByDate(events: CalendarEvent[]): [string, CalendarEvent[]][] {
  const map = new Map<string, CalendarEvent[]>()
  for (const e of events) {
    const key = e.dateLabel || "unknown"
    const list = map.get(key) ?? []
    list.push(e)
    map.set(key, list)
  }
  return Array.from(map.entries())
}

export function CalendarCard({
  gcal,
  nowIso,
  range,
  savedTimezone,
}: {
  gcal: GCalResult
  nowIso: string
  range: CalRange
  savedTimezone?: string | null
}) {
  if (!gcal.connected) {
    const hasError = "error" in gcal && gcal.error
    return (
      <Card className="flex h-full flex-col overflow-hidden border-dashed">
        <CardHeader className="drag-handle cursor-grab pb-3 active:cursor-grabbing">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <CalendarIcon className="size-4 text-muted-foreground" />
              Google Calendar
            </CardTitle>
            {hasError ? <LoadErrorStatus /> : <NotConnectedStatus />}
          </div>
          {!hasError && (
            <CardDescription className="text-xs">
              Sign in with your <span className="font-medium">@fanvue.com</span> Google account to connect.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-3 pt-0">
          {hasError ? (
            <LoadErrorBody message={gcal.error!} />
          ) : (
            <>
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-8 text-center">
                <CalendarIcon className="size-7 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">Connect to see your calendar</p>
              </div>
              <Button size="sm" variant="outline" className="w-full" asChild>
                <a href="/api/auth/login">Sign in with Google</a>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    )
  }

  const { events, calendarLink } = gcal
  const grouped = range === "today" ? null : groupByDate(events)
  const todayStr = nowIso.slice(0, 10)

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className="drag-handle shrink-0 cursor-grab pb-2 active:cursor-grabbing">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <CalendarIcon className="size-4 text-muted-foreground" />
            Google Calendar
          </CardTitle>
          <div className="flex items-center gap-2">
            <ConnectedStatus />
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" asChild>
              <a href={calendarLink} target="_blank" rel="noopener noreferrer" aria-label="Open Google Calendar">
                Open <ExternalLinkIcon className="size-3" />
              </a>
            </Button>
          </div>
        </div>
        <CalendarRangeTabs current={range} />
        <CardDescription className="text-xs">
          {events.length === 0
            ? `Nothing scheduled ${RANGE_LABELS[range].toLowerCase()}.`
            : `${events.length} event${events.length === 1 ? "" : "s"}`}
        </CardDescription>
      </CardHeader>

      <CardContent
        aria-live="polite"
        aria-relevant="additions text"
        className="min-h-0 flex-1 overflow-y-auto pt-0"
      >
        {events.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg bg-muted/40 py-8 text-center">
            <span className="text-2xl">🎉</span>
            <p className="text-sm text-muted-foreground">
              {range === "today" ? "No meetings today — enjoy the focus time!" : "Nothing scheduled."}
            </p>
          </div>
        ) : range === "today" ? (
          <div className="flex flex-col gap-1">
            {events.map((e) => {
              const now = isHappeningNow(e, nowIso)
              return (
                <a
                  key={e.id}
                  href={e.htmlLink ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted ${now ? "bg-primary/5 ring-1 ring-primary/20" : ""}`}
                >
                  <span className="w-20 shrink-0 text-xs text-muted-foreground tabular-nums leading-tight">
                    <CalendarEventTime iso={e.start} isAllDay={!!e.isAllDay} savedTimezone={savedTimezone} />
                  </span>
                  <span className="flex-1 truncate font-medium">{e.title}</span>
                  {e.isAllDay ? (
                    <Badge variant="secondary" className="text-xs font-normal">all day</Badge>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">{eventDuration(e.start, e.end)}</span>
                  )}
                </a>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {(grouped ?? []).map(([date, dayEvents]) => (
              <div key={date}>
                <p className={`mb-1 px-2 text-xs font-semibold ${date === todayStr ? "text-primary" : "text-muted-foreground"}`}>
                  {date === todayStr ? "Today" : formatDayHeader(date)}
                </p>
                <div className="flex flex-col gap-0.5">
                  {dayEvents.map((e) => (
                    <a
                      key={e.id}
                      href={e.htmlLink ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                    >
                      <span className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">
                        {e.isAllDay ? "All day" : formatEventTime(e.start, false)}
                      </span>
                      <span className="flex-1 truncate">{e.title}</span>
                      {!e.isAllDay && (
                        <span className="shrink-0 text-xs text-muted-foreground">{eventDuration(e.start, e.end)}</span>
                      )}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
