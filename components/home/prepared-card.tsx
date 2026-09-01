"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  ExternalLinkIcon,
  Loader2Icon,
  PencilIcon,
  LockIcon,
  SendIcon,
  SparklesIcon,
} from "lucide-react"

import { StatusTag, Tag } from "@/components/ui/status-tag"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { SendConfirmDialog } from "@/components/send-confirm-dialog"
import { usePlatform } from "@/hooks/use-platform"
import { readApiError } from "@/lib/api-error"
import type { AttentionItem, PreparedSource } from "@/lib/briefing/types"

// The prepared work under an expanded row: the customer draft from the reply
// queue, a researched answer for a colleague, or a read-only summary. Every
// outbound action is a single explicit click. A needs_check draft sends only
// through the locked variant of SendConfirmDialog, where the agent asserts the
// fadmin check; fadmin itself opens in the desktop app, so a locked draft also
// offers a way there.

const SOURCE_INITIAL: Record<PreparedSource["kind"], string> = {
  notion: "N",
  slack: "#",
  macro: "M",
  playbook: "P",
  article: "A",
  case: "C",
}

function SourceList({ sources }: { sources: PreparedSource[] }) {
  if (sources.length === 0) return null
  return (
    <ul className="mt-2.5 flex flex-col gap-1">
      {sources.map((s, i) => (
        <li key={`${s.kind}-${i}`} className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
          <span className="grid size-[18px] shrink-0 place-items-center rounded-sm border bg-card text-[10px] font-bold text-foreground">
            {SOURCE_INITIAL[s.kind] ?? "·"}
          </span>
          {s.url ? (
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate underline-offset-2 hover:underline"
            >
              {s.label}
            </a>
          ) : (
            <span className="truncate">{s.label}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

function PreparedLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
      <SparklesIcon className="size-3 text-muted-foreground" />
      {children}
    </div>
  )
}

function Body({ text }: { text: string }) {
  return (
    <p className="text-[13px] leading-relaxed break-words whitespace-pre-line text-foreground/90">
      {text}
    </p>
  )
}

export function PreparedCard({
  item,
  onHandled,
  downloadUrl,
}: {
  item: AttentionItem
  /**
   * The agent acted on this item, so Home should stop showing it: a draft sent
   * or rejected, an answer sent in Slack, or a deep link opened at the source.
   * The parent posts the dismissal and offers an Undo. Deliberately NOT called
   * by the locked "Check in fadmin" / "Check on desktop" links — those are a
   * step toward sending, not the end of the item.
   */
  onHandled: (id: string) => void
  downloadUrl?: string
}) {
  const prepared = item.prepared
  const { isDesktopApp } = usePlatform()
  const [body, setBody] = useState(prepared && "body" in prepared ? prepared.body : "")
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState<"send" | "reject" | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  if (!prepared) {
    return (
      <div className="bg-muted px-3.5 py-3 text-[12.5px] text-muted-foreground">
        {item.pending
          ? "Looking this one up now — the prepared reply will appear here."
          : "Nothing prepared for this one. Open it at the source to handle it."}
        <div className="mt-2.5">
          <Button size="sm" variant="outline" asChild>
            <a
              href={item.deepLink}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onHandled(item.id)}
            >
              <ExternalLinkIcon />
              Open it
            </a>
          </Button>
        </div>
      </div>
    )
  }

  const bodyChanged = body.trim() !== prepared.body.trim()

  // ── draft: the reply-queue customer reply ────────────────────────────────
  if (prepared.kind === "draft") {
    const locked = prepared.band === "needs_check"
    const caseHref = `/cases/${item.externalId}/canvas`

    const send = async () => {
      if (busy) return
      setBusy("send")
      try {
        const res = await fetch("/api/draft/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: item.externalId,
            body,
            // True only after the locked confirm dialog (see SendConfirmDialog).
            needsCheckConfirmed: locked,
          }),
        })
        if (!res.ok) {
          toast.error(await readApiError(res, `Couldn't send (${res.status})`))
          setBusy(null)
          return
        }
      } catch {
        toast.error("Couldn't send. Open the case and try there.")
        setBusy(null)
        return
      }

      // Best-effort queue clear — the reply already went out.
      const resolved = await fetch("/api/reply-queue/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: item.externalId,
          suggestionId: prepared.suggestionId,
          action: bodyChanged ? "edit" : "approve",
          bodyChanged,
          finalBody: body,
        }),
      }).catch(() => null)
      if (!resolved?.ok) {
        toast.warning("Sent, but the queue row may take a moment to clear.")
      } else {
        toast.success("Sent to the customer")
      }
      onHandled(item.id)
    }

    const reject = async () => {
      if (busy) return
      setBusy("reject")
      const res = await fetch("/api/reply-queue/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: item.externalId,
          suggestionId: prepared.suggestionId,
          action: "reject",
        }),
      }).catch(() => null)
      if (!res?.ok) {
        toast.error("Couldn't dismiss this draft.")
        setBusy(null)
        return
      }
      toast.success("Draft dismissed")
      onHandled(item.id)
    }

    return (
      <div className="bg-muted px-3.5 py-3">
        {locked && (
          <div className="mb-2.5 flex items-start gap-2.5 rounded-md border bg-card px-3 py-2.5 text-[12.5px] leading-snug text-muted-foreground">
            <LockIcon className="mt-0.5 size-3.5 shrink-0 text-foreground" />
            <div>
              <b className="block font-semibold text-foreground">Verify in fadmin before sending</b>
              {prepared.lockReason ??
                "This one is prepared, but sending stays locked until you check it in fadmin."}{" "}
              fadmin opens in the desktop app; once you have checked, you can send from here.
            </div>
          </div>
        )}

        <PreparedLabel>
          Prepared reply
          {prepared.band === "ready" && <StatusTag tone="ok">Ready</StatusTag>}
          {locked && <StatusTag tone="warn">Locked</StatusTag>}
          {prepared.band === "low_confidence" && <StatusTag>Review</StatusTag>}
        </PreparedLabel>

        {editing ? (
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="min-h-40 text-[13px] leading-relaxed"
            autoFocus
          />
        ) : (
          <Body text={body} />
        )}

        <SourceList sources={prepared.sources} />

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <>
              <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={busy !== null}>
                {busy === "send" ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
                Approve &amp; send
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing((e) => !e)}
                disabled={busy !== null}
              >
                <PencilIcon />
                {editing ? "Done" : "Edit"}
              </Button>
              {locked && !isDesktopApp ? (
                <Button size="sm" variant="ghost" asChild>
                  <a
                    href={downloadUrl ?? caseHref}
                    target={downloadUrl ? "_blank" : undefined}
                    rel={downloadUrl ? "noopener noreferrer" : undefined}
                  >
                    Check on desktop
                  </a>
                </Button>
              ) : (
                <Button size="sm" variant="ghost" asChild>
                  <Link href={caseHref} onClick={locked ? undefined : () => onHandled(item.id)}>
                    {locked ? "Check in fadmin" : "Open case"}
                  </Link>
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto text-muted-foreground"
                onClick={() => void reject()}
                disabled={busy !== null}
              >
                {busy === "reject" && <Loader2Icon className="animate-spin" />}
                Reject
              </Button>
            </>
        </div>

        <SendConfirmDialog
          open={confirmOpen}
          locked={locked}
          onOpenChange={setConfirmOpen}
          onConfirm={() => {
            setConfirmOpen(false)
            void send()
          }}
        />
      </div>
    )
  }

  // ── answer: a researched reply to a colleague in Slack ───────────────────
  if (prepared.kind === "answer") {
    const sendSlack = async () => {
      if (busy) return
      setBusy("send")
      const res = await fetch("/api/slack/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: prepared.replyTo.channelId,
          text: body,
          threadTs: prepared.replyTo.threadTs,
        }),
      }).catch(() => null)
      if (!res?.ok) {
        toast.error("Couldn't send that to Slack.")
        setBusy(null)
        return
      }
      toast.success("Sent in Slack")
      onHandled(item.id)
    }

    return (
      <div className="bg-muted px-3.5 py-3">
        <PreparedLabel>
          Prepared answer
          {prepared.sources.length > 0 && (
            <Tag>
              {prepared.sources.length} {prepared.sources.length === 1 ? "source" : "sources"}
            </Tag>
          )}
        </PreparedLabel>

        {editing ? (
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="min-h-32 text-[13px] leading-relaxed"
            autoFocus
          />
        ) : (
          <Body text={body} />
        )}

        <SourceList sources={prepared.sources} />

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Button size="sm" onClick={() => void sendSlack()} disabled={busy !== null}>
            {busy === "send" ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
            Send in Slack
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditing((e) => !e)}
            disabled={busy !== null}
          >
            <PencilIcon />
            {editing ? "Done" : "Edit"}
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <a
              href={item.deepLink}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onHandled(item.id)}
            >
              Open thread
            </a>
          </Button>
        </div>
      </div>
    )
  }

  // ── summary: read-only. Money decisions never get a draft. ───────────────
  return (
    <div className="bg-muted px-3.5 py-3">
      <PreparedLabel>
        Summary
        <Tag>You answer this one</Tag>
      </PreparedLabel>
      <Body text={prepared.body} />
      <div className="mt-3">
        <Button size="sm" asChild>
          <a
            href={item.deepLink}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onHandled(item.id)}
          >
            <ExternalLinkIcon />
            Reply in Gmail
          </a>
        </Button>
      </div>
    </div>
  )
}
