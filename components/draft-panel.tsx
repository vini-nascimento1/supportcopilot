"use client"

import { useState } from "react"
import { SparklesIcon, Loader2Icon, AlertCircleIcon } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { CopyButton } from "@/components/copy-button"

interface Props {
  conversationId: string
  playbookId: string | undefined
  playbookName: string | undefined
  existingDraft: { version: number; replyBody: string } | null
}

export function DraftPanel({ conversationId, playbookId, playbookName, existingDraft }: Props) {
  const [draft, setDraft] = useState<{ body: string; loading: boolean; error: string | null }>({
    body: existingDraft?.replyBody ?? "",
    loading: false,
    error: null,
  })

  const hasExistingDraft = !!existingDraft

  async function generateDraft() {
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
        setDraft({ body: "", loading: false, error: text || `Request failed (${res.status})` })
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
      setDraft({ body: "", loading: false, error: e instanceof Error ? e.message : "Network error" })
    }
  }

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <SparklesIcon className="size-4 text-primary" />
          AI Draft Answer
        </CardTitle>
        {playbookName && (
          <CardDescription className="line-clamp-2 text-xs">
            Based on: {playbookName}
          </CardDescription>
        )}
        {hasExistingDraft && !draft.loading && !draft.error && (
          <CardDescription className="text-xs">
            Version {existingDraft?.version} — generated via Claude Code
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {draft.loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Generating draft…
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
              <CopyButton text={draft.body} />
            </div>
            <pre className="whitespace-pre-wrap rounded-md border bg-background p-3 font-sans text-sm leading-relaxed">
              {draft.body}
            </pre>
            <p className="text-xs text-muted-foreground">
              Copy into Intercom, review, then send.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              {hasExistingDraft
                ? "A draft from Claude Code was loaded above."
                : "Generate an AI-powered draft reply based on the matched playbook."}
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
    </Card>
  )
}
