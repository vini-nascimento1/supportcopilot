import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeftIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { CaseCanvas } from "@/components/canvas/case-canvas"
import { CanvasTabs } from "@/components/canvas/canvas-tabs"
import { CanvasModeGuard } from "@/components/canvas/canvas-mode-guard"
import { getConversationDetail } from "@/lib/intercom"
import { getTopMatches } from "@/lib/case-intelligence"
import { getPlaybooksDashboardData } from "@/lib/playbooks"
import { getCaseTools } from "@/lib/case-tools-db"
import { getDesktopDownloadUrl } from "@/lib/desktop-download"

export const dynamic = "force-dynamic"

// Case Canvas Workspace — one canvas per case. Customer context comes live
// from Intercom (cases in the DB is metadata-only). Layout persists in
// localStorage keyed by conversation id.
export default async function CaseCanvasPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const [conversation, playbooksData, tools, downloadUrl] = await Promise.all([
    getConversationDetail(id),
    getPlaybooksDashboardData(),
    getCaseTools(),
    getDesktopDownloadUrl(),
  ])
  if (!conversation) notFound()

  const searchText = [
    conversation.subject,
    conversation.firstMessage,
    ...conversation.messages
      .filter((m) => m.role === "customer")
      .map((m) => m.body),
  ]
    .filter(Boolean)
    .join(" ")
  const topMatch = getTopMatches(searchText, playbooksData.allRows, 1)[0]

  return (
    <div className="flex h-svh w-full flex-col">
      <CanvasModeGuard workspaceId={id} />
      <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-background px-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/cases/${id}`}>
            <ArrowLeftIcon className="size-4" />
            Case
          </Link>
        </Button>
        <CanvasTabs
          current={{ id, title: conversation.customer || `#${id}` }}
        />
      </header>
      <div className="min-h-0 flex-1">
        <CaseCanvas
          storageKey={id}
          tools={tools}
          ticketText={searchText}
          downloadUrl={downloadUrl}
          caseInfo={{
            conversationId: id,
            customerName: conversation.customer,
            customerEmail: conversation.email,
            state: conversation.state,
            topic: conversation.topic,
            tags: conversation.tags,
            intercomUrl: conversation.intercomUrl,
          }}
          conversation={{
            subject: conversation.subject,
            messages: conversation.messages,
          }}
          playbookId={topMatch?.playbook.id}
          playbookName={topMatch?.playbook.caseType}
        />
      </div>
    </div>
  )
}
