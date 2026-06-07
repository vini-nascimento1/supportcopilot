import Link from "next/link"
import { ArrowLeftIcon, ExternalLinkIcon } from "lucide-react"
import { notFound } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { WorkspaceLayout } from "@/components/workspace-layout"
import { GmailReply } from "@/components/gmail-reply"
import { getAgentTokens } from "@/lib/auth"
import { getGmailThread, markThreadRead } from "@/lib/gmail-client"

export const dynamic = "force-dynamic"

function formatDate(iso: string): string {
  if (!iso) return "Unknown date"
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function EmailBody({ plain, html }: { plain: string; html: string }) {
  // Prefer plain text if available — safer and more readable.
  if (plain) {
    return (
      <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
        {plain}
      </pre>
    )
  }

  // HTML-only emails: render in a sandboxed iframe so the operator can
  // actually read the content instead of seeing "(HTML message)".
  if (html) {
    return (
      <iframe
        srcDoc={html}
        sandbox="allow-same-origin"
        title="Email content"
        className="min-h-[200px] w-full rounded border bg-background"
        style={{ height: "auto" }}
      />
    )
  }

  return (
    <p className="text-sm text-muted-foreground">(No body)</p>
  )
}

function MessageCard({
  message,
  isFirst,
}: {
  message: {
    id: string
    from: string
    fromName: string
    to: string
    date: string
    bodyPlain: string
    bodyHtml: string
    isUnread: boolean
  }
  isFirst: boolean
}) {
  return (
    <div className={`flex flex-col gap-2 rounded-lg border bg-card p-4 ${isFirst ? "" : "mt-3"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{message.fromName || message.from}</p>
          <p className="text-xs text-muted-foreground">{message.from}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            To: {message.to}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {message.isUnread && (
            <Badge variant="default" className="text-xs">New</Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {formatDate(message.date)}
          </span>
        </div>
      </div>
      <Separator />
      <EmailBody plain={message.bodyPlain} html={message.bodyHtml} />
    </div>
  )
}

export default async function GmailThreadPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const tokens = await getAgentTokens()

  if (!tokens.googleToken) {
    return (
      <WorkspaceLayout>
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <p className="font-medium">Gmail not connected</p>
          <Button asChild><a href="/api/auth/login">Sign in with Google</a></Button>
        </div>
      </WorkspaceLayout>
    )
  }

  const thread = await getGmailThread(tokens.googleToken, id, tokens.email)
  if (!thread) notFound()

  // Mark as read silently (fire-and-forget)
  void markThreadRead(tokens.googleToken, tokens.email, id)

  const lastMsg = thread.messages[thread.messages.length - 1]
  const firstMsg = thread.messages[0]

  // Reply-to: find the last message NOT sent by us.
  const myEmail = tokens.email?.toLowerCase() ?? ""
  function extractEmail(from: string): string {
    const match = from.match(/<([^>]+)>$/)
    return (match?.[1] ?? from).toLowerCase()
  }
  const lastExternalMsg = [...thread.messages]
    .reverse()
    .find((m) => extractEmail(m.from) !== myEmail)
  const replyTo = lastExternalMsg?.from ?? lastMsg?.from ?? firstMsg?.from ?? ""
  const replySubject = thread.subject.startsWith("Re:")
    ? thread.subject
    : `Re: ${thread.subject}`
  const lastMessageId = lastMsg?.messageId ?? null
  const allMessageIds = thread.messages
    .map((m) => m.messageId)
    .filter(Boolean)
    .join(" ")

  return (
    <WorkspaceLayout>
      <header className="flex min-h-14 items-center gap-3 border-b px-4 lg:px-6">
        <SidebarTrigger />
        <Separator orientation="vertical" className="min-h-6" />
        <Link
          href="/gmail"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
          {thread.subject}
        </h1>
        <Button size="sm" variant="ghost" asChild>
          <a
            href={`https://mail.google.com/mail/u/0/#inbox/${id}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in Gmail
            <ExternalLinkIcon className="size-3" />
          </a>
        </Button>
      </header>

      <main className="flex flex-col gap-0 p-4 lg:p-6">
        <h2 className="mb-4 text-xl font-semibold">{thread.subject}</h2>

        <div className="flex flex-col gap-3">
          {thread.messages.map((msg, i) => (
            <MessageCard key={msg.id} message={msg} isFirst={i === 0} />
          ))}
        </div>

        <GmailReply
          threadId={id}
          to={replyTo}
          subject={replySubject}
          inReplyTo={lastMessageId}
          references={allMessageIds || null}
        />
      </main>
    </WorkspaceLayout>
  )
}
