import { Suspense } from "react"
import { after } from "next/server"

import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { StatusTag } from "@/components/ui/status-tag"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { WorkspaceLayout } from "@/components/workspace-layout"
import { AgentNameGate } from "@/components/home/agent-name-gate"
import { BriefingBoard } from "@/components/home/briefing-board"
import { DayTimeline } from "@/components/home/day-timeline"
import { EmailDigest } from "@/components/home/email-digest"
import { HomeGreeting } from "@/components/home/home-greeting"
import { SectionHeader } from "@/components/home/section-header"
import { SlackDigest } from "@/components/home/slack-digest"
import {
  BriefingBoardSkeleton,
  DigestsSkeleton,
  StatusBadgeSkeleton,
} from "@/components/home/home-skeletons"
import { getBriefing, markHomeSeen } from "@/components/home/data"
import { getAgentProfile } from "@/lib/agent"
import { getDesktopDownloadUrl } from "@/lib/desktop-download"
import type { Briefing } from "@/lib/briefing/types"

export const dynamic = "force-dynamic"

// Home: the copilot's briefing. It opens with what needs the agent, each item
// carries the work already prepared for it, and nothing leaves the app without
// an explicit click. Replaces the old draggable dashboard grid.
// Design: docs/plans/2026-09-01-home-briefing.md (workstream C).

// One failed briefing must not blank the page: fall back to an empty one whose
// source statuses say what broke.
async function loadBriefing(email: string | null): Promise<Briefing> {
  try {
    return await getBriefing(email)
  } catch (err) {
    console.error("[home] briefing failed:", err)
    const message = "Couldn't build your briefing. Refresh to retry."
    return {
      generatedAt: new Date().toISOString(),
      since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      narrative: message,
      narrativeSource: "fallback",
      counts: { now: 0, drafted: 0, researched: 0, locked: 0 },
      items: [],
      sources: [
        { source: "intercom", state: "error", message },
        { source: "slack", state: "error", message },
        { source: "gmail", state: "error", message },
        { source: "calendar", state: "error", message },
      ],
    }
  }
}

async function StatusBadge({ briefing }: { briefing: Promise<Briefing> }) {
  const { sources } = await briefing
  const failed = sources.filter((s) => s.state === "error").length
  const live = sources.some((s) => s.state === "ok")
  const tone = failed === sources.length ? "critical" : live ? (failed > 0 ? "warn" : "ok") : "neutral"
  const label = failed === sources.length ? "Error" : live ? "Live" : "Setup"

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <StatusTag tone={tone} pulse={tone === "ok"}>
          {label}
        </StatusTag>
      </TooltipTrigger>
      <TooltipContent>
        {failed === sources.length
          ? "Couldn't reach your sources. Refresh to retry."
          : live
            ? failed > 0
              ? `Live, but ${failed} source${failed === 1 ? "" : "s"} didn't answer.`
              : "Pulling from Intercom, Slack, Gmail and Calendar."
            : "Connect your tools in Settings to fill this in."}
      </TooltipContent>
    </Tooltip>
  )
}

async function LeftColumn({
  briefing,
  downloadUrl,
}: {
  briefing: Promise<Briefing>
  downloadUrl: string
}) {
  return <BriefingBoard briefing={await briefing} downloadUrl={downloadUrl} />
}

async function RightColumn({ briefing }: { briefing: Promise<Briefing> }) {
  const data = await briefing
  // "Starts soon" is measured against the moment the briefing was built, so the
  // render stays pure (and matches the whenLabels the server already computed).
  const generatedMs = Date.parse(data.generatedAt)
  const nowMs = Number.isNaN(generatedMs) ? 0 : generatedMs
  const status = (source: Briefing["sources"][number]["source"]) =>
    data.sources.find((s) => s.source === source) ?? { source, state: "ok" as const, count: 0 }

  const events = data.items.filter((i) => i.kind === "calendar_event")
  const slack = data.items.filter((i) => i.source === "slack")
  const email = data.items.filter((i) => i.source === "gmail")

  return (
    <>
      <section>
        <SectionHeader title="Today" count={events.length} detail="events" />
        <DayTimeline events={events} status={status("calendar")} nowMs={nowMs} />
      </section>

      <section>
        <SectionHeader title="Slack you missed" count={slack.length} detail="new" />
        <SlackDigest items={slack} status={status("slack")} since={data.since} />
        <p className="mt-2 px-0.5 text-[11px] leading-snug text-muted-foreground">
          Only mentions, DMs and threads you are in. Channels stay in Slack.
        </p>
      </section>

      <section>
        <SectionHeader title="Worth your time in email" count={email.length} />
        <EmailDigest items={email} status={status("gmail")} since={data.since} />
      </section>
    </>
  )
}

export default async function HomePage() {
  const [agent, downloadUrl] = await Promise.all([getAgentProfile(), getDesktopDownloadUrl()])

  const header = (title: string, badge: React.ReactNode) => (
    <header className="flex min-h-14 items-center gap-3 border-b px-4 lg:px-6">
      <SidebarTrigger />
      <Separator orientation="vertical" className="min-h-6" />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h1 className="text-base font-medium">{title}</h1>
        {badge}
      </div>
    </header>
  )

  // Blocking one-field step (workstream A): customer-facing replies must never
  // fall back to the Google profile name, so the briefing waits behind it.
  if (agent.agentName == null) {
    return (
      <WorkspaceLayout>
        {header("Home", null)}
        <main className="p-4 lg:p-6">
          <AgentNameGate />
        </main>
      </WorkspaceLayout>
    )
  }

  const briefing = loadBriefing(agent.email)
  after(() => markHomeSeen(agent.email))

  return (
    <WorkspaceLayout>
      {header(
        "Home",
        <Suspense fallback={<StatusBadgeSkeleton />}>
          <StatusBadge briefing={briefing} />
        </Suspense>,
      )}

      <main className="p-4 lg:p-6">
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12 lg:gap-x-6">
          <div className="flex min-w-0 flex-col gap-5 lg:col-span-7">
            <HomeGreeting firstName={agent.firstName} savedTimezone={agent.timezone} />
            <Suspense fallback={<BriefingBoardSkeleton />}>
              <LeftColumn briefing={briefing} downloadUrl={downloadUrl} />
            </Suspense>
          </div>
          <div className="flex min-w-0 flex-col gap-5 lg:col-span-5">
            <Suspense fallback={<DigestsSkeleton />}>
              <RightColumn briefing={briefing} />
            </Suspense>
          </div>
        </div>
      </main>
    </WorkspaceLayout>
  )
}
