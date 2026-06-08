"use client"

import { useState } from "react"
import {
  ChevronDownIcon,
  ThumbsDownIcon,
  XIcon,
  Loader2Icon,
  CheckIcon,
} from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { PlaybookChecklist } from "@/components/playbook-checklist"
import { parseSteps } from "@/lib/parse-steps"
import { CopyButton } from "@/components/copy-button"
import { MarkdownPreview } from "@/components/markdown-preview"
import { mdToHtml } from "@/lib/md-to-html"
import type { PlaybookListItem } from "@/lib/playbooks"
import type { ResponseItem } from "@/lib/playbooks"

interface Props {
  playbook: PlaybookListItem
  confidence: "high" | "medium" | "low"
  trigger: string
  responses: ResponseItem[]
  conversationId: string
}

function stripFrPrefix(text: string) {
  return text.replace(/^FR:\s*/i, "").trim()
}

function confidenceColor(c: "high" | "medium" | "low") {
  return c === "high"
    ? "default"
    : c === "medium"
      ? "secondary"
      : ("outline" as const)
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
        <CopyButton text={body} htmlText={mdToHtml(body)} />
      </div>
      <MarkdownPreview content={body} />
    </div>
  )
}

export function PlaybookCard({ playbook, confidence, trigger, responses, conversationId }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedbackReason, setFeedbackReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  if (dismissed) return null

  async function handleDismiss() {
    setSaving(true)
    try {
      const res = await fetch("/api/playbook-dismissals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          playbookId: playbook.id,
          reason: feedbackReason,
        }),
      })
      if (!res.ok) {
        console.error("Failed to dismiss playbook:", await res.text())
        return
      }
      setSaved(true)
      // Brief "Saved" state before hiding
      setTimeout(() => setDismissed(true), 800)
    } catch (e) {
      console.error("Failed to dismiss playbook:", e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-start gap-2">
            <Badge variant={confidenceColor(confidence)}>{confidence}</Badge>
            <Badge variant="outline" className="font-normal">
              via &ldquo;{trigger}&rdquo;
            </Badge>
          </div>

          {/* header actions */}
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={() => setShowFeedback((p) => !p)}
              className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
              title="Dismiss playbook"
            >
              <ThumbsDownIcon className="size-3.5" />
            </button>
            <button
              onClick={() => setCollapsed((p) => !p)}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted transition-colors"
              title={collapsed ? "Expand" : "Collapse"}
            >
              <ChevronDownIcon
                className={`size-4 transition-transform ${collapsed ? "" : "rotate-180"}`}
              />
            </button>
          </div>
        </div>

        <CardTitle className="text-base pr-8">{playbook.caseType}</CardTitle>
        {playbook.recognize && (
          <CardDescription className="line-clamp-2">
            {playbook.recognize}
          </CardDescription>
        )}
      </CardHeader>

      {/* Inline feedback form */}
      {showFeedback && !saved && (
        <div className="mx-4 mb-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <p className="mb-2 text-xs font-medium text-destructive">
            Why is this playbook not suitable?
          </p>
          <textarea
            value={feedbackReason}
            onChange={(e) => setFeedbackReason(e.target.value)}
            placeholder="e.g. wrong topic, outdated steps, missing context…"
            className="mb-2 w-full resize-none rounded-md border bg-background p-2 text-xs outline-none focus:ring-1 focus:ring-primary"
            rows={2}
            autoFocus
          />
          <div className="flex items-center justify-end gap-1.5">
            <button
              onClick={() => {
                setShowFeedback(false)
                setFeedbackReason("")
              }}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDismiss}
              disabled={saving}
              className="flex items-center gap-1 rounded-md bg-destructive px-2.5 py-1 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
            >
              {saving ? (
                <Loader2Icon className="size-3 animate-spin" />
              ) : (
                <XIcon className="size-3" />
              )}
              {saving ? "Saving…" : "Dismiss"}
            </button>
          </div>
        </div>
      )}

      {/* "Saved" confirmation */}
      {saved && (
        <div className="mx-4 mb-2 flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
          <CheckIcon className="size-3.5" />
          Dismissal recorded
        </div>
      )}

      {!collapsed && (
        <CardContent className="flex flex-col gap-5">
          {/* checklist */}
          <Section emoji="⚠️" title="Before replying — checks">
            <PlaybookChecklist checks={playbook.checks} />
          </Section>

          {/* response templates */}
          <Section emoji="💬" title="Response templates">
            <div className="flex flex-col gap-3">
              {responses.map((r) => (
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
      )}
    </Card>
  )
}
