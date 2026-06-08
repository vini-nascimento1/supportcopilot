"use client"

import { useEffect, useState } from "react"
import { CalendarIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { AgentMetrics } from "@/lib/intercom"

function fmtPct(v: number | null): string {
  if (v == null) return "—"
  return `${Math.round(v)}`
}

function fmtSecToMin(sec: number | null): string {
  if (sec == null) return "—"
  if (sec < 60) return `<1m`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ${Math.round(sec % 60)}s`
  return `${Math.floor(min / 60)}h ${min % 60}m`
}

function fmtRating(v: number | null): string {
  if (v == null) return "—"
  return v.toFixed(1)
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export default function MetricsClient() {
  const [metrics, setMetrics] = useState<AgentMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const today = new Date()
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 86_400_000)

  const [startDate, setStartDate] = useState<Date>(thirtyDaysAgo)
  const [endDate, setEndDate] = useState<Date>(today)

  function loadData(start: Date, end: Date) {
    setLoading(true)
    setError(null)
    const startTs = Math.floor(start.getTime() / 1000)
    const endTs = Math.floor(end.getTime() / 1000) + 86_400
    fetch(`/api/metrics?start=${startTs}&end=${endTs}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error)
          setMetrics(null)
        } else {
          setMetrics(data)
        }
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Network error")
        setMetrics(null)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadData(startDate, endDate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <header className="flex min-h-14 items-center gap-3 border-b px-4 lg:px-6">
        <SidebarTrigger />
        <Separator orientation="vertical" className="min-h-6" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="text-base font-medium">Metrics</h1>
        </div>
      </header>

      <main className="flex-1 space-y-4 p-4 lg:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
                <CalendarIcon className="size-3" />
                {startDate ? fmtDate(startDate) : "Start"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={startDate}
                onSelect={(d) => d && setStartDate(d)}
                autoFocus
              />
            </PopoverContent>
          </Popover>

          <span className="text-xs text-muted-foreground">→</span>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
                <CalendarIcon className="size-3" />
                {endDate ? fmtDate(endDate) : "End"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={endDate}
                onSelect={(d) => d && setEndDate(d)}
                autoFocus
              />
            </PopoverContent>
          </Popover>

          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={() => loadData(startDate, endDate)}
            disabled={loading}
          >
            {loading ? "Loading…" : "Update"}
          </Button>

          {metrics && (
            <Badge variant="outline" className="text-xs">
              {metrics.periodDays} days
            </Badge>
          )}
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading && !metrics && (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            Loading metrics…
          </div>
        )}

        {metrics && (
          <>
            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Conversations</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold">{fmtPct(metrics.totalConversations)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{fmtPct(metrics.perDayConversations ?? 0)} / work day · {metrics.workingDays ?? metrics.periodDays} working days</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Avg CSAT</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold">{fmtRating(metrics.avgCsat)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {metrics.csatCount != null ? `${metrics.perDayCsat ?? metrics.csatCount} / day · ${metrics.csatCount} total` : "no ratings"}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Reassignments</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold">{fmtRating(metrics.avgAssignments ?? 0)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">avg per conversation</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Reopens</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold">{fmtRating(metrics.avgReopens ?? 0)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">avg per conversation</p>
                  </CardContent>
                </Card>
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Response Times</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Avg First Response</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold">{fmtSecToMin(metrics.avgFrtSec)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">FRT (average)</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Median First Response</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold">{fmtSecToMin(metrics.medianFrtSec)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">FRT (median)</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Avg Resolution Time</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold">{fmtSecToMin(metrics.avgTimeToResolveSec)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Time to first close</p>
                  </CardContent>
                </Card>
              </div>
            </section>
          </>
        )}
      </main>
    </>
  )
}
