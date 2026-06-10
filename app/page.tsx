import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { WorkspaceLayout } from "@/components/workspace-layout"
import { DashboardGrid } from "@/components/dashboard-grid"
import { CalendarCard } from "@/components/cards/calendar-card"
import { DashboardGreeting } from "@/components/dashboard-greeting"
import { IntercomCardLive } from "@/components/cards/intercom-card-live"
import { GmailCardLive } from "@/components/cards/gmail-card-live"
import { NotionCard } from "@/components/cards/notion-card"
import { SlackMiniCard } from "@/components/cards/slack-mini-card"
import { getOpenCasesQueue, type CasesQueueData } from "@/lib/intercom"
import { getPlaybooksDashboardData } from "@/lib/playbooks"
import { getAgentProfile, getGreeting } from "@/lib/agent"
import { getAgentTokens } from "@/lib/auth"
import { getCalendarEvents, type CalRange, type GCalResult } from "@/lib/gcal"
import { getGmailUnreadCount, type GmailResult } from "@/lib/gmail-client"
import { getSlackUnreadSummary, type SlackUnreadResult } from "@/lib/slack"

export const dynamic = "force-dynamic"

async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    console.error(`[dashboard] ${label} failed:`, err)
    return fallback
  }
}

function getNextMeetingMinutes(gcal: GCalResult, nowIso: string): number | undefined {
  if (gcal.connected !== true) return undefined
  const now = new Date(nowIso).getTime()
  const upcoming = gcal.events
    .filter((e) => !e.isAllDay && e.start && new Date(e.start).getTime() > now)
    .sort((a, b) => new Date(a.start!).getTime() - new Date(b.start!).getTime())
  if (upcoming.length === 0) return undefined
  return Math.max(0, Math.round((new Date(upcoming[0].start!).getTime() - now) / 60000))
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ cal?: string }>
}) {
  const nowIso = new Date().toISOString()
  const appId = process.env.INTERCOM_APP_ID ?? "yzo8ff0f"
  const { cal } = await searchParams
  const range: CalRange = cal === "week" || cal === "month" ? cal : "today"

  const [playbooks, agent, tokens] = await Promise.all([
    safe("playbooks", getPlaybooksDashboardData, {
      mode: "error" as const,
      error: "Couldn't load playbooks.",
      playbookCount: 0,
      responseCount: 0,
      reviewedCount: 0,
      rows: [],
      allRows: [],
    }),
    safe("agent profile", getAgentProfile, {
      firstName: "there",
      name: null,
      email: null,
      intercomAdminId: process.env.INTERCOM_ADMIN_ID ?? null,
    }),
    safe("agent tokens", getAgentTokens, {
      email: null,
      name: null,
      googleToken: null,
      slackToken: null,
      notionToken: null,
    }),
  ])

  const [gcal, gmail, slack] = await Promise.all([
    safe<GCalResult>(
      "calendar",
      () => getCalendarEvents(range, nowIso, tokens.googleToken, tokens.email),
      { connected: false, error: "Couldn't load Calendar. Retry shortly." },
    ),
    safe<GmailResult>(
      "gmail unread",
      () => getGmailUnreadCount(tokens.googleToken, tokens.email),
      { connected: false, error: "Couldn't load Gmail. Retry shortly." },
    ),
    safe<SlackUnreadResult>(
      "slack unread",
      () => getSlackUnreadSummary(tokens.slackToken),
      { connected: false, unreadCount: 0, workspaceUrl: "", error: "Couldn't load Slack. Retry shortly." },
    ),
  ])

  const cases = await safe<CasesQueueData>(
    "cases queue",
    () => getOpenCasesQueue(playbooks.allRows, agent.intercomAdminId),
    { mode: "error", error: "Couldn't load Intercom queue. Retry shortly.", rows: [] },
  )

  const greeting = getGreeting(nowIso)
  const todayLabel = new Date(nowIso).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })

  return (
    <WorkspaceLayout>
      <header className="flex min-h-14 items-center gap-3 border-b px-4 lg:px-6">
        <SidebarTrigger />
        <Separator orientation="vertical" className="min-h-6" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="text-base font-medium">Dashboard</h1>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant={
                  cases.mode === "live"
                    ? "secondary"
                    : cases.mode === "error"
                    ? "destructive"
                    : "default"
                }
              >
                {cases.mode === "live" ? "Live" : cases.mode === "error" ? "Error" : "Demo"}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              {cases.mode === "live"
                ? "Pulling from real Intercom data."
                : cases.mode === "error"
                ? "Couldn't reach Intercom — showing the last good state. Refresh to retry."
                : "Showing seeded sample data — connect Intercom in Settings to go live."}
            </TooltipContent>
          </Tooltip>
        </div>
      </header>

      <main className="flex flex-col">
        {/* greeting — full on first visit, compressed thereafter */}
        <DashboardGreeting
          greeting={greeting}
          firstName={agent.firstName}
          todayLabel={todayLabel}
          caseCount={(cases.rows ?? []).length}
          nextMeetingMinutes={getNextMeetingMinutes(gcal, nowIso)}
        />

        <DashboardGrid
          calendarCard={<CalendarCard gcal={gcal} nowIso={nowIso} range={range} />}
          intercomCard={<IntercomCardLive initial={cases} appId={appId} />}
          gmailCard={<GmailCardLive initial={gmail} />}
          slackCard={<SlackMiniCard slack={slack} />}
          notionCard={<NotionCard />}
        />
      </main>
    </WorkspaceLayout>
  )
}
