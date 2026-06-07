import Link from "next/link"
import { notFound } from "next/navigation"
import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  MessageSquareIcon,
  UserIcon,
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
import { PlaybookChecklist } from "@/components/playbook-checklist"
import { parseSteps } from "@/lib/parse-steps"
import { CopyButton } from "@/components/copy-button"
import { MarkdownPreview } from "@/components/markdown-preview"
import { DraftPanel } from "@/components/draft-panel"
import { getConversationDetail } from "@/lib/intercom"
import { getTopMatches } from "@/lib/case-intelligence"
import { getDraftForConversation } from "@/lib/drafts"
import { getAgentProfile } from "@/lib/agent"
import {
  getPlaybooksDashboardData,
  getResponsesForPlaybookIds,
  type ResponseItem,
  type PlaybookListItem,
} from "@/lib/playbooks"

export const dynamic = "force-dynamic"

function confidenceColor(c: "high" | "medium" | "low") {
  return c === "high"
    ? "default"
    : c === "medium"
      ? "secondary"
      : ("outline" as const)
}

function stripFrPrefix(text: string) {
  return text.replace(/^FR:\s*/i, "").trim()
}

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

function Section({
  emoji,
  title,
  children,
}: {
  emoji: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <span>{emoji}</span>
        {title}
      </h3>
      {children}
    </div>
  )
}

function ResponseCard({ response }: { response: ResponseItem }) {
  const body = stripFrPrefix(response.body)
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          {response.title}
        </p>
        <CopyButton text={body} />
      </div>
      <MarkdownPreview content={body} />
    </div>
  )
}

export default async function CasePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const [conversation, playbooksData, existingDraft, agentProfile] = await Promise.all([
    getConversationDetail(id),
    getPlaybooksDashboardData(),
    getDraftForConversation(id),
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
                const displayResponses =
                  responses.length > 0 ? responses : [buildFallbackDraft(playbook, agentProfile.firstName)]

                return (
                  <Card key={playbook.id}>
                    <CardHeader className="pb-2">
                      <div className="flex flex-wrap items-start gap-2">
                        <Badge variant={confidenceColor(confidence)}>
                          {confidence}
                        </Badge>
                        <Badge variant="outline" className="font-normal">
                          via &ldquo;{trigger}&rdquo;
                        </Badge>
                      </div>
                      <CardTitle className="text-base">{playbook.caseType}</CardTitle>
                      {playbook.recognize && (
                        <CardDescription className="line-clamp-2">
                          {playbook.recognize}
                        </CardDescription>
                      )}
                    </CardHeader>

                    <CardContent className="flex flex-col gap-5">
                      {/* checklist */}
                      <Section emoji="⚠️" title="Before replying — checks">
                        <PlaybookChecklist checks={playbook.checks} />
                      </Section>

                      {/* response templates */}
                      <Section emoji="💬" title="Response templates">
                        <div className="flex flex-col gap-3">
                          {displayResponses.map((r) => (
                            <ResponseCard key={r.id} response={r} />
                          ))}
                        </div>
                      </Section>

                      {/* resolution */}
                      {playbook.resolution && (
                        <details>
                          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                            ✅ Resolution steps
                          </summary>
                          <div className="mt-2">
                            {(() => {
                              const steps = parseSteps(playbook.resolution)
                              return steps.length > 1 ? (
                                <ol className="flex list-none flex-col gap-1">
                                  {steps.map((step, i) => (
                                    <li key={i} className="flex gap-2 text-sm">
                                      <span className="mt-0.5 shrink-0 font-mono text-xs text-muted-foreground">
                                        {i + 1}.
                                      </span>
                                      <span>{step}</span>
                                    </li>
                                  ))}
                                </ol>
                              ) : (
                                <p className="text-sm">{playbook.resolution}</p>
                              )
                            })()}
                          </div>
                        </details>
                      )}

                      {/* dos/don'ts */}
                      {playbook.dosDonts && (
                        <details>
                          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                            🚫 Known mistakes / don&apos;ts
                          </summary>
                          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                            {playbook.dosDonts}
                          </p>
                        </details>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>

        {/* right: sidebar */}
        <div className="flex flex-col gap-4">
          {/* draft panel — always first */}
          <DraftPanel
            conversationId={id}
            playbookId={matches[0]?.playbook.id}
            playbookName={matches[0]?.playbook.caseType}
            existingDraft={existingDraft}
          />

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <UserIcon className="size-4 text-muted-foreground" />
                Case details
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">Customer</span>
                <span className="font-medium">{conversation.customer}</span>
                {conversation.email && (
                  <span className="text-xs text-muted-foreground">
                    {conversation.email}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">State</span>
                <Badge
                  variant={conversation.state === "open" ? "default" : "outline"}
                  className="w-fit"
                >
                  {conversation.state}
                </Badge>
              </div>

              {conversation.topic && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">Topic</span>
                  <span>{conversation.topic}</span>
                </div>
              )}

              {conversation.tags.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Tags</span>
                  <div className="flex flex-wrap gap-1">
                    {conversation.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="font-normal">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {conversation.updatedAt && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">Last updated</span>
                  <span className="text-xs">
                    {new Date(conversation.updatedAt).toLocaleString("en-GB", { timeZone: "Europe/London" })}
                  </span>
                </div>
              )}

              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">
                  Conversation ID
                </span>
                <span className="font-mono text-xs">{id}</span>
              </div>
            </CardContent>
          </Card>

          {conversation.intercomUrl && (
            <Button asChild className="w-full">
              <a
                href={conversation.intercomUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLinkIcon className="size-4" />
                Open in Intercom
              </a>
            </Button>
          )}

          <Card className="border-dashed">
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Drafts shown are for reference only — never sent automatically.
                Copy-paste into Intercom, review, then send.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
