"use client"

import { useRef, useState } from "react"
import { SendIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

type Props = {
  threadId: string
  to: string
  subject: string
  inReplyTo: string | null
  references: string | null
  onSent?: () => void
}

export function GmailReply({ threadId, to, subject, inReplyTo, references, onSent }: Props) {
  const [body, setBody] = useState("")
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  async function handleSend() {
    if (!body.trim()) return
    setStatus("sending")
    setErrorMsg("")

    try {
      const res = await fetch("/api/gmail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          subject,
          body: body.trim(),
          threadId,
          inReplyTo: inReplyTo ?? undefined,
          references: references
            ? `${references} ${inReplyTo ?? ""}`.trim()
            : (inReplyTo ?? undefined),
        }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) {
        setStatus("error")
        setErrorMsg(data.error ?? "Send failed")
        return
      }
      setStatus("sent")
      setBody("")
      onSent?.()
    } catch (e) {
      setStatus("error")
      setErrorMsg(e instanceof Error ? e.message : "Network error")
    }
  }

  if (status === "sent") {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
        <span>✓</span>
        <span>Reply sent.</span>
        <button
          onClick={() => setStatus("idle")}
          className="ml-auto text-xs underline hover:no-underline"
        >
          Write another
        </button>
      </div>
    )
  }

  return (
    <div className="mt-4 flex flex-col gap-2 rounded-lg border bg-muted/20 p-4">
      <p className="text-xs font-medium text-muted-foreground">
        Reply to <span className="font-semibold text-foreground">{to}</span>
      </p>

      <Textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write your reply…"
        className="min-h-32 resize-y bg-background text-sm"
        disabled={status === "sending"}
      />

      {status === "error" && (
        <p className="text-xs text-destructive">{errorMsg}</p>
      )}

      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={handleSend}
          disabled={!body.trim() || status === "sending"}
        >
          <SendIcon className="size-3.5" />
          {status === "sending" ? "Sending…" : "Send reply"}
        </Button>
      </div>
    </div>
  )
}
