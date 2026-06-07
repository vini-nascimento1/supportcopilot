import Link from "next/link"
import {
  ExternalLinkIcon,
  FileTextIcon,
  TerminalIcon,
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
import { CopyButton } from "@/components/copy-button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { WorkspaceLayout } from "@/components/workspace-layout"
import { getSavedDrafts } from "@/lib/drafts"

export const dynamic = "force-dynamic"

const INTERCOM_APP_ID = process.env.INTERCOM_APP_ID ?? "yzo8ff0f"

function intercomUrl(conversationId: string) {
  return `https://app.intercom.com/a/inbox/${INTERCOM_APP_ID}/inbox/conversation/${conversationId}`
}

export default async function DraftsPage() {
  const drafts = await getSavedDrafts()

  return (
    <WorkspaceLayout>
      <header className="flex min-h-14 items-center gap-3 border-b px-4 lg:px-6">
        <SidebarTrigger />
        <Separator orientation="vertical" className="min-h-6" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="text-base font-medium">Drafts</h1>
          {drafts.length > 0 && (
            <Badge variant="secondary">{drafts.length}</Badge>
          )}
        </div>
      </header>

      <main className="flex flex-col gap-6 p-4 lg:p-6">
        {/* how it works */}
        <Card className="border-dashed bg-muted/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <TerminalIcon className="size-4 text-muted-foreground" />
              How drafts are generated
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
            <p>
              Drafts are created by running the{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
                /draft
              </code>{" "}
              skill in Claude Code. It fetches the Intercom conversation,
              matches it against a playbook, and produces a copy-paste reply
              in Fanvue&apos;s voice plus internal next steps.
            </p>
            <ol className="flex list-none flex-col gap-1 pl-0">
              <li className="flex gap-2">
                <span className="shrink-0 font-mono text-xs">1.</span>
                Open Claude Code in this project directory.
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 font-mono text-xs">2.</span>
                <span>
                  Run{" "}
                  <code className="rounded bg-muted px-1 font-mono text-xs text-foreground">
                    /draft 215474600342787
                  </code>{" "}
                  (use the Intercom conversation ID from the Cases page).
                </span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 font-mono text-xs">3.</span>
                The draft is saved to Supabase and appears in this list.
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 font-mono text-xs">4.</span>
                Copy-paste the reply into Intercom. Never sent automatically.
              </li>
            </ol>
            <p className="mt-1">
              After the case is resolved, run{" "}
              <code className="rounded bg-muted px-1 font-mono text-xs text-foreground">
                /log-case &lt;id&gt; good|bad
              </code>{" "}
              to feed the outcome back into the playbook self-improvement loop.
            </p>
          </CardContent>
        </Card>

        {/* saved drafts */}
        {drafts.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <FileTextIcon className="size-8 text-muted-foreground/40" />
              <div>
                <p className="text-sm font-medium">No drafts yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Run{" "}
                  <code className="rounded bg-muted px-1 font-mono text-xs">
                    /draft &lt;conversation-id&gt;
                  </code>{" "}
                  in Claude Code to generate your first draft.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            <h2 className="text-sm font-medium text-muted-foreground">
              Saved drafts ({drafts.length})
            </h2>
            {drafts.map((draft) => (
              <Card key={draft.id}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-col gap-1">
                      <CardTitle className="text-base">
                        {draft.customerName ?? "Unknown customer"}
                        <span className="ml-2 text-sm font-normal text-muted-foreground">
                          v{draft.version}
                        </span>
                      </CardTitle>
                      <CardDescription>
                        {new Date(draft.createdAt).toLocaleString("en-GB", { timeZone: "Europe/London" })}
                        {draft.intercomConversationId && (
                          <>
                            {" · "}
                            <Link
                              href={`/cases/${draft.intercomConversationId}`}
                              className="hover:underline"
                            >
                              View case
                            </Link>
                            {" · "}
                            <a
                              href={intercomUrl(draft.intercomConversationId)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-0.5 hover:underline"
                            >
                              Intercom
                              <ExternalLinkIcon className="size-3" />
                            </a>
                          </>
                        )}
                      </CardDescription>
                    </div>
                    <Badge
                      variant={
                        draft.caseStatus === "resolved"
                          ? "secondary"
                          : "outline"
                      }
                    >
                      {draft.caseStatus}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="flex flex-col gap-4">
                  {/* reply */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        💬 Draft reply
                      </span>
                      <CopyButton text={draft.replyBody} />
                    </div>
                    <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-sans text-sm leading-relaxed">
                      {draft.replyBody}
                    </pre>
                  </div>

                  {/* next steps */}
                  {draft.nextSteps && (
                    <details>
                      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                        ✅ Next steps for you
                      </summary>
                      <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed text-muted-foreground">
                        {draft.nextSteps}
                      </pre>
                    </details>
                  )}

                  {/* sources */}
                  {draft.sources && (
                    <details>
                      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                        📚 Sources
                      </summary>
                      <pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed text-muted-foreground">
                        {draft.sources}
                      </pre>
                    </details>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </WorkspaceLayout>
  )
}
