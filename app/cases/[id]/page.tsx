import Link from "next/link"
import { notFound } from "next/navigation"
import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  LayoutDashboardIcon,
  MessageSquareIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { parseSteps } from "@/lib/parse-steps"
import { CaseSidebar } from "@/components/case-sidebar"
import { PlaybookCard } from "@/components/playbook-card"
import { getConversationDetail } from "@/lib/intercom"
import { getTopMatches } from "@/lib/case-intelligence"
import { getAgentProfile } from "@/lib/agent"
import {
  getPlaybooksDashboardData,
  getResponsesForPlaybookIds,
  type ResponseItem,
  type PlaybookListItem,
} from "@/lib/playbooks"

export const dynamic = "force-dynamic"

function buildFallbackDraft(playbook: PlaybookListItem, agentName: string): ResponseItem {
  const lines = [`Hey! 👋 Thanks for reaching out to Fanvue Support, I'm ${agentName} and I'll do my best to help! 😊`]

  if (playbook.resolution) {
    const steps = parseSteps(playbook.resolution)
    if (steps.length > 1) {
      lines.push("")
      steps.forEach((step, i) => {
        lines.push(`${i + 1}. ${step}`)
      })
    } else {
      lines.push("", playbook.resolution)
    }
  }

  lines.push("", "Let me know if you need anything else — happy to help! 💛")

  return {
    id: `fallback-${playbook.id}`,
    title: `Draft for: ${playbook.caseType}`,
    body: lines.join("\n"),
  }
}

export default async function CasePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const [conversation, playbooksData, agentProfile] = await Promise.all([
    getConversationDetail(id),
    getPlaybooksDashboardData(),
    getAgentProfile(),
  ])

  if (!conversation) {
    notFound()
  }

  const searchText = [
    conversation.subject,
    conversation.firstMessage,
    ...conversation.messages.filter((m) => m.role === "customer").map((m) => m.body),
  ]
    .filter(Boolean)
    .join(" ")

  const matches = getTopMatches(searchText, playbooksData.allRows, 4)
  const responseMap = await getResponsesForPlaybookIds(matches.map((m) => m.playbook.id))

  return (
    <div className="min-h-screen bg-background">
      {/* header */}
      <header className="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur lg:px-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/">
            <ArrowLeftIcon className="size-4" />
            Cases
          </Link>
        </Button>
        <Separator orientation="vertical" className="min-h-6" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {conversation.customer}
            {conversation.subject && (
              <span className="ml-2 text-muted-foreground">
                · {conversation.subject}
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">#{id}</p>
        </div>
        <Badge
          variant={
            conversation.state === "open"
              ? "default"
              : conversation.state === "snoozed"
                ? "secondary"
                : "outline"
          }
        >
          {conversation.state}
        </Badge>
        <Button size="sm" variant="outline" asChild>
          <Link href={`/cases/${id}/canvas`}>
            <LayoutDashboardIcon className="size-3.5" />
            Open in canvas
          </Link>
        </Button>
        {conversation.intercomUrl && (
          <Button size="sm" variant="outline" asChild>
            <a
              href={conversation.intercomUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLinkIcon className="size-3.5" />
              Open in Intercom
            </a>
          </Button>
        )}
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 p-4 lg:grid-cols-3 lg:p-6">
        {/* left: message + playbooks */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          {/* customer message */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageSquareIcon className="size-4 text-muted-foreground" />
                Customer message
              </CardTitle>
              {conversation.subject && (
                <CardDescription>Subject: {conversation.subject}</CardDescription>
              )}
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {conversation.firstMessage || "No message body."}
              </p>
              {conversation.messages.filter((m) => m.role === "customer").length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                    Show thread ({conversation.messages.length} parts)
                  </summary>
                  <div className="mt-3 flex flex-col gap-3 border-l-2 pl-3">
                    {conversation.messages.map((msg, i) => (
                      <div key={i} className="flex flex-col gap-0.5">
                        <span className="text-xs font-medium text-muted-foreground">
                          {msg.author}{" "}
                          <span className="font-normal">
                            ·{" "}
                            {msg.createdAt
                              ? new Date(msg.createdAt).toLocaleString("en-GB", { timeZone: "Europe/London" })
                              : ""}
                          </span>
                        </span>
                        <p className="whitespace-pre-wrap text-sm leading-snug">
                          {msg.body}
                        </p>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </CardContent>
          </Card>

          {/* matched playbooks */}
          {matches.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">
                  No playbook matched. Search manually in the Playbooks tab.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-4">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Matched playbooks ({matches.length})
              </h2>
              {matches.map(({ playbook, confidence, trigger }) => {
                const responses = responseMap.get(playbook.id) ?? []

                return (
                  <PlaybookCard
                    key={playbook.id}
                    playbook={playbook}
                    confidence={confidence}
                    trigger={trigger}
                    responses={responses.length > 0 ? responses : [buildFallbackDraft(playbook, agentProfile.firstName)]}
                    conversationId={id}
                  />
                )
              })}
            </div>
          )}
        </div>

        {/* right: sidebar */}
        <CaseSidebar
          conversationId={id}
          playbookId={matches[0]?.playbook.id}
          playbookName={matches[0]?.playbook.caseType}
          customerEmail={conversation.email}
          customerName={conversation.customer}
          conversationState={conversation.state}
          conversationTopic={conversation.topic}
          conversationTags={conversation.tags}
          conversationUpdatedAt={conversation.updatedAt}
          intercomUrl={conversation.intercomUrl}
        />
      </main>
    </div>
  )
}
