import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { WorkspaceLayout } from "@/components/workspace-layout"
import { getAgentContext } from "@/lib/automation/rules"
import { searchMetricsForAdmin } from "@/lib/intercom"
import type { AgentMetrics } from "@/lib/intercom"

export const dynamic = "force-dynamic"

function fmtPct(v: number | null): string {
  if (v == null) return "—"
  return `${Math.round(v)}`
}

function fmtSecToMin(sec: number | null): string {
  if (sec == null) return "—"
  if (sec < 60) return `<1m`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`
  return `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m`
}

function fmtRating(v: number | null): string {
  if (v == null) return "—"
  return v.toFixed(1)
}

export default async function MetricsPage() {
  const { db, agentId } = await getAgentContext()
  if (!db || !agentId) return <div className="p-8 text-sm text-muted-foreground">Authentication required</div>

  const { data: agent } = await db.from("agents").select("intercom_admin_id").eq("id", agentId).maybeSingle()
  const adminId = agent?.intercom_admin_id as string | null | undefined

  let m: AgentMetrics | null = null
  let error: string | null = null

  if (adminId) {
    try {
      m = await searchMetricsForAdmin(adminId, 30)
    } catch (e) {
      error = (e as Error).message
    }
  } else {
    error = "No Intercom admin ID configured"
  }

  return (
    <WorkspaceLayout>
      <header className="flex min-h-14 items-center gap-3 border-b px-4 lg:px-6">
        <SidebarTrigger />
        <Separator orientation="vertical" className="min-h-6" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="text-base font-medium">Metrics</h1>
          <Badge variant="outline">Last 30 days</Badge>
        </div>
      </header>

      <main className="flex-1 space-y-6 p-4 lg:p-6">
        {error && (
          <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
        )}

        {m && (
          <>
            {/* Row 1: Volume + CSAT */}
            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Conversations</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold">{fmtPct(m.totalConversations)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      conversations in {m.periodDays} days
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Avg CSAT</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold">{fmtRating(m.avgCsat)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {m.csatCount != null ? `from ${m.csatCount} rating(s)` : "no ratings"}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Reassignments</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold">{fmtRating(m.avgAssignments ?? 0)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">avg per conversation</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Reopens</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold">{fmtRating(m.avgReopens ?? 0)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">avg per conversation</p>
                  </CardContent>
                </Card>
              </div>
            </section>

            {/* Row 2: Timing metrics */}
            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Response Times</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Avg First Response
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold">{fmtSecToMin(m.avgFrtSec)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">FRT (average)</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Median First Response
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold">{fmtSecToMin(m.medianFrtSec)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">FRT (median)</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Avg Resolution Time
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-bold">{fmtSecToMin(m.avgTimeToResolveSec)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Time to first close</p>
                  </CardContent>
                </Card>
              </div>
            </section>
          </>
        )}

        {!m && !error && (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            Loading metrics…
          </div>
        )}
      </main>
    </WorkspaceLayout>
  )
}
