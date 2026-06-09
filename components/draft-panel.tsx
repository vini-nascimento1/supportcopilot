"use client"

import { useState, useEffect, useRef } from "react"
import { SparklesIcon, Loader2Icon, AlertCircleIcon, SendIcon, InfoIcon } from "lucide-react"
import { toast } from "sonner"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { CopyButton } from "@/components/copy-button"
import { SendConfirmDialog } from "@/components/send-confirm-dialog"
import { Textarea } from "@/components/ui/textarea"
import { mdToHtml } from "@/lib/md-to-html"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface Props {
  conversationId: string
  playbookId: string | undefined
  playbookName: string | undefined
  externalDraft?: string | null
  onDraftConsumed?: () => void
}

const LOADING_STEPS = [
  "Reading the conversation thread…",
  "Browsing internal articles…",
  "Analyzing the playbook…",
  "Drafting your reply…",
]

export function DraftPanel({ conversationId, playbookId, playbookName, externalDraft, onDraftConsumed }: Props) {
  const [draft, setDraft] = useState<{ body: string; loading: boolean; error: string | null }>({
    body: "",
    loading: false,
    error: null,
  })
  const [loadingStep, setLoadingStep] = useState(0)
  const [sending, setSending] = useState(false)
  const [sendDialogOpen, setSendDialogOpen] = useState(false)
  const stepRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const previousBodyRef = useRef<string>("")

  // Consume external draft when provided (e.g. from Slack thread finder)
  useEffect(() => {
    if (externalDraft !== null && externalDraft !== undefined) {
      setDraft({ body: externalDraft, loading: false, error: null })
      onDraftConsumed?.()
    }
  }, [externalDraft, onDraftConsumed])

  // Cycle through loading steps while generating
  useEffect(() => {
    if (!draft.loading) {
      if (stepRef.current) clearInterval(stepRef.current)
      return
    }
    setLoadingStep(0)
    stepRef.current = setInterval(() => {
      setLoadingStep((prev) => (prev + 1) % LOADING_STEPS.length)
    }, 3000)
    return () => {
      if (stepRef.current) clearInterval(stepRef.current)
    }
  }, [draft.loading])

  async function generateDraft() {
    previousBodyRef.current = draft.body
    setDraft({ body: "", loading: true, error: null })

    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          ...(playbookId ? { playbookId } : {}),
        }),
      })

      if (!res.ok) {
        const text = await res.text()
        setDraft({ body: previousBodyRef.current, loading: false, error: text || `Request failed (${res.status})` })
        return
      }

      const reader = res.body?.getReader()
      if (!reader) {
        setDraft({ body: "", loading: false, error: "No response body" })
        return
      }

      let body = ""
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        body += decoder.decode(value, { stream: true })
      }

      setDraft({ body, loading: false, error: null })
    } catch (e) {
      setDraft({ body: previousBodyRef.current, loading: false, error: e instanceof Error ? e.message : "Network error" })
    }
  }

  function handleSendClick() {
    if (!draft.body) return
    setSendDialogOpen(true)
  }

  async function handleSendConfirm() {
    setSendDialogOpen(false)
    setSending(true)
    try {
      const res = await fetch("/api/draft/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, body: draft.body }),
      })

      if (!res.ok) {
        const text = await res.text()
        toast.error(text || `Failed to send (${res.status})`)
        return
      }

      toast.success("Reply sent to Intercom ✅")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Network error")
    } finally {
      setSending(false)
    }
  }

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <SparklesIcon className="size-4 text-primary" />
          Intercom AI Answer
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="text-muted-foreground hover:text-foreground transition-colors">
                  <InfoIcon className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-64 text-xs leading-relaxed">
                Generates a customer-facing draft reply using your matched playbook, the conversation thread, and internal knowledge base articles as context.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardTitle>
        {playbookName && (
          <CardDescription className="line-clamp-2 text-xs">
            Based on: {playbookName}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {draft.loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            {LOADING_STEPS[loadingStep]}
          </div>
        ) : draft.error ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <AlertCircleIcon className="size-3.5 shrink-0" />
              {draft.error}
            </div>
            <button
              onClick={generateDraft}
              className="text-xs text-primary hover:underline"
            >
              Try again
            </button>
          </div>
        ) : draft.body ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Draft reply</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={generateDraft}
                  className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/50"
                >
                  <SparklesIcon className="size-3" />
                  Regenerate
                </button>
                <CopyButton text={draft.body} htmlText={mdToHtml(draft.body)} />
                <button
                  onClick={handleSendClick}
                  disabled={sending}
                  className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {sending ? (
                    <Loader2Icon className="size-3 animate-spin" />
                  ) : (
                    <SendIcon className="size-3" />
                  )}
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
            <Textarea
              value={draft.body}
              onChange={(e) => setDraft((prev) => ({ ...prev, body: e.target.value }))}
              className="min-h-[200px] resize-y text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Edit the draft directly, then copy or send to Intercom.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              Generate an AI-powered draft reply based on the matched playbook.
            </p>
            <button
              onClick={generateDraft}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <SparklesIcon className="size-3.5" />
              Generate draft
            </button>
          </div>
        )}
      </CardContent>
      <SendConfirmDialog
        open={sendDialogOpen}
        onOpenChange={setSendDialogOpen}
        onConfirm={handleSendConfirm}
      />
    </Card>
  )
}
