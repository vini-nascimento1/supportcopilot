import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { WorkspaceLayout } from "@/components/workspace-layout"
import { DashboardGrid } from "@/components/dashboard-grid"
import { CalendarCard } from "@/components/cards/calendar-card"
import { IntercomCardLive } from "@/components/cards/intercom-card-live"
import { GmailCardLive } from "@/components/cards/gmail-card-live"
import { NotionCard } from "@/components/cards/notion-card"
import { SlackMiniCard } from "@/components/cards/slack-mini-card"
import { getOpenCasesQueue } from "@/lib/intercom"
import { getPlaybooksDashboardData } from "@/lib/playbooks"
import { getAgentProfile, getGreeting } from "@/lib/agent"
import { getAgentTokens } from "@/lib/auth"
import { getCalendarEvents, type CalRange } from "@/lib/gcal"
import { getGmailUnreadCount } from "@/lib/gmail-client"
import { getSlackUnreadSummary } from "@/lib/slack"

export const dynamic = "force-dynamic"

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
    getPlaybooksDashboardData(),
    getAgentProfile(),
    getAgentTokens(),
  ])

  const [gcal, gmail, slack] = await Promise.all([
    getCalendarEvents(range, nowIso, tokens.googleToken, tokens.email),
    getGmailUnreadCount(tokens.googleToken, tokens.email),
    getSlackUnreadSummary(tokens.slackToken),
  ])

  const cases = await getOpenCasesQueue(playbooks.allRows, agent.intercomAdminId)

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
          <Badge variant={cases.mode === "live" ? "default" : "secondary"}>
            {cases.mode === "live" ? "Live" : "Demo"}
          </Badge>
        </div>
      </header>

      <main className="flex flex-col">
        {/* greeting */}
        <section className="px-4 pt-4 lg:px-6 lg:pt-6">
          <h2 className="text-2xl font-semibold tracking-tight">
            {greeting}, {agent.firstName}! 👋
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{todayLabel}</p>
        </section>

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
