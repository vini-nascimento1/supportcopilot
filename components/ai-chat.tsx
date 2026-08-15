"use client"

import { useEffect, useRef, useState } from "react"
import { BotIcon, RotateCcwIcon, SendIcon, XIcon } from "lucide-react"
import ReactMarkdown from "react-markdown"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Message = {
  id: string
  role: "user" | "assistant"
  content: string
  toolsUsed?: string[]
}

// Human-readable labels for the tools the assistant may have actually run —
// shown under a reply so the agent can see what it looked at, not just the
// prose. Falls back to the raw tool name for anything not listed here.
const TOOL_LABELS: Record<string, string> = {
  list_rules: "Automation rules",
  get_rule: "Automation rules",
  create_rule: "Automation rules",
  update_rule: "Automation rules",
  delete_rule: "Automation rules",
  test_rule: "Live conversation test",
  get_insights: "Rules & queue stats",
  search_playbooks: "Playbooks",
  search_cases: "Your open cases",
  research_ticket: "Ticket thread + Notion/Slack/Linear/Drive",
  draft_reply: "Draft generation",
}

function formatToolsUsed(toolsUsed: string[] | undefined): string | null {
  if (!toolsUsed || toolsUsed.length === 0) return null
  const labels = Array.from(new Set(toolsUsed.map((t) => TOOL_LABELS[t] ?? t)))
  return labels.join(" · ")
}

type Confirmation = {
  toolCallId: string
  name: string
  args: Record<string, unknown>
  summary: string
}

let msgCounter = 0
function nextId(): string {
  return `msg-${++msgCounter}-${Date.now()}`
}

const MAX_MESSAGES = 50

// research_ticket (reading a full Intercom thread + a Notion/Slack/Linear/
// Drive search) can genuinely take a while — this keeps the loading state
// honest instead of looking stuck behind the same three dots the whole time.
const LOADING_STAGES = [
  "Thinking…",
  "Still working on it…",
  "Digging through the ticket and your knowledge base — hang tight…",
]

// Write tools (create/update/delete a rule) come back from the API as a
// { confirmation, pendingState } response instead of executing immediately —
// this renders that as a Yes/No card and resumes the conversation with
// whatever the user picks. `pendingState` is opaque: we just hold it and
// send it back verbatim, the server knows what to do with it.
export function AIChat() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [loadingStage, setLoadingStage] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [pendingState, setPendingState] = useState<unknown>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const abortRef = useRef<AbortController | null>(null)
  const loadingTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  function startLoading() {
    loadingTimersRef.current.forEach(clearTimeout)
    setLoadingStage(0)
    loadingTimersRef.current = [
      setTimeout(() => setLoadingStage(1), 6_000),
      setTimeout(() => setLoadingStage(2), 20_000),
    ]
    setLoading(true)
  }

  function stopLoading() {
    loadingTimersRef.current.forEach(clearTimeout)
    loadingTimersRef.current = []
    setLoading(false)
  }

  // Starts a fresh conversation — also doubles as a cancel button for a
  // stuck/slow research_ticket or draft_reply call, since it aborts whatever
  // request is still in flight.
  function resetConversation() {
    abortRef.current?.abort()
    stopLoading()
    setMessages([])
    setInput("")
    setError(null)
    setConfirmation(null)
    setPendingState(null)
  }

  useEffect(() => {
    return () => {
      loadingTimersRef.current.forEach(clearTimeout)
      abortRef.current?.abort()
    }
  }, [])

  function scrollToBottom() {
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" })
    })
  }

  // Shared by a fresh message and a confirm/decline resume — both eventually
  // get back either a final { message } or another { confirmation, pendingState }.
  async function callApi(body: Record<string, unknown>, signal: AbortSignal) {
    const res = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? "Something went wrong")
      stopLoading()
      scrollToBottom()
      return
    }
    if (data.confirmation) {
      setConfirmation(data.confirmation)
      setPendingState(data.pendingState)
      stopLoading()
      scrollToBottom()
      return
    }
    const assistantMsg: Message = {
      id: nextId(),
      role: "assistant",
      content: data.message,
      toolsUsed: data.toolsUsed,
    }
    setMessages((prev) => [...prev, assistantMsg].slice(-MAX_MESSAGES))
    stopLoading()
    scrollToBottom()
  }

  async function send() {
    const text = input.trim()
    if (!text || loading) return
    setInput("")
    setError(null)
    setConfirmation(null)
    setPendingState(null)

    abortRef.current?.abort()
    const abort = new AbortController()
    abortRef.current = abort

    const userMsg: Message = { id: nextId(), role: "user", content: text }
    const updated = [...messages, userMsg]
    setMessages(updated)
    startLoading()
    scrollToBottom()

    try {
      await callApi({ messages: updated.map(({ role, content }) => ({ role, content })) }, abort.signal)
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return
      setError("Network error. Check your connection.")
      stopLoading()
      scrollToBottom()
    }
  }

  async function respondToConfirmation(confirmed: boolean) {
    if (!confirmation || loading) return
    const toolCallId = confirmation.toolCallId
    setError(null)
    setConfirmation(null)
    startLoading()
    scrollToBottom()

    abortRef.current?.abort()
    const abort = new AbortController()
    abortRef.current = abort

    try {
      await callApi({ pendingState, toolCallId, confirmed }, abort.signal)
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return
      setError("Network error. Check your connection.")
      stopLoading()
      scrollToBottom()
    } finally {
      setPendingState(null)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <>
      {/* FAB button. data-canvas-chrome: embedded native tool views (Fadmin
          etc.) paint above ALL web content — this marks the button as chrome
          so canvas tool views are clipped around it instead of burying it
          (see lib/canvas-bounds.ts). */}
      <button
        onClick={() => setOpen(!open)}
        data-canvas-chrome="right"
        className="fixed bottom-6 right-6 z-50 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-all hover:scale-105 hover:shadow-xl active:scale-95"
        aria-label={open ? "Close AI chat" : "Open AI chat"}
      >
        {open ? <XIcon className="size-5" /> : <BotIcon className="size-5" />}
      </button>

      {/* Chat panel. data-canvas-chrome keeps native tool views clipped to
          its left edge while it's open (they'd otherwise paint over it); the
          max-w keeps it usable on small laptops instead of a fixed 440px. */}
      {open && (
        <div
          data-canvas-chrome="right"
          className="fixed bottom-22 right-6 z-50 flex w-[440px] max-w-[calc(100vw-3rem)] flex-col rounded-xl border bg-card shadow-2xl transition-all duration-200 animate-in slide-in-from-bottom-4"
        >
          {/* Header */}
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <BotIcon className="size-4 text-primary" />
            <span className="text-sm font-semibold">AI Assistant</span>
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto size-7"
                title="New conversation"
                onClick={resetConversation}
              >
                <RotateCcwIcon className="size-3.5" />
              </Button>
            )}
          </div>

          {/* Messages */}
          <div
            ref={listRef}
            className="flex max-h-[min(560px,calc(100dvh-16rem))] min-h-[250px] flex-col gap-3 overflow-y-auto p-4"
          >
            {messages.length === 0 && !loading && !confirmation && (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-center text-sm text-muted-foreground">
                  Ask about automation rules, look up a playbook, check your open cases, or paste an
                  Intercom ticket to research it against Notion/Slack/Linear.
                  <br />
                  <span className="text-xs">
                    e.g. &ldquo;what playbook covers a stuck KYC?&rdquo; or paste a ticket link and ask &ldquo;what&rsquo;s going on here?&rdquo;
                  </span>
                </p>
              </div>
            )}

            {messages.map((m) => {
              const toolsLine = m.role === "assistant" ? formatToolsUsed(m.toolsUsed) : null
              return (
                <div key={m.id} className={`max-w-[85%] ${m.role === "user" ? "ml-auto" : "mr-auto"}`}>
                  <div
                    className={`rounded-xl px-3 py-2 text-sm leading-relaxed ${
                      m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                    }`}
                  >
                    {m.role === "assistant" ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_code]:rounded [&_code]:bg-muted-foreground/20 [&_code]:px-1 [&_code]:text-xs">
                        <ReactMarkdown>{m.content}</ReactMarkdown>
                      </div>
                    ) : (
                      m.content
                    )}
                  </div>
                  {toolsLine && (
                    <p className="mt-1 truncate px-1 text-[11px] text-muted-foreground" title={toolsLine}>
                      🔎 Checked: {toolsLine}
                    </p>
                  )}
                </div>
              )
            })}

            {confirmation && (
              <div className="mr-auto max-w-[90%] rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm">
                <p className="font-medium text-amber-700 dark:text-amber-400">Confirm this action</p>
                <p className="mt-0.5 leading-relaxed">{confirmation.summary}</p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    className="h-7 px-3 text-xs"
                    onClick={() => respondToConfirmation(true)}
                    disabled={loading}
                  >
                    Yes, do it
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-3 text-xs"
                    onClick={() => respondToConfirmation(false)}
                    disabled={loading}
                  >
                    No
                  </Button>
                </div>
              </div>
            )}

            {loading && (
              <div className="mr-auto flex max-w-[85%] items-center gap-2 rounded-xl bg-muted px-3 py-2">
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
                </span>
                {loadingStage > 0 && (
                  <span className="text-xs text-muted-foreground">{LOADING_STAGES[loadingStage]}</span>
                )}
              </div>
            )}

            {error && (
              <div className="flex items-center justify-between rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <span>{error}</span>
                <button onClick={() => setError(null)} className="ml-2 font-semibold underline">
                  Dismiss
                </button>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="flex items-center gap-2 border-t px-4 py-3">
            <Input
              ref={inputRef}
              className="h-9"
              placeholder={confirmation ? "Respond to the confirmation above…" : "Ask anything..."}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading || !!confirmation}
            />
            <Button
              onClick={send}
              disabled={loading || !!confirmation || !input.trim()}
              size="icon"
              className="size-9"
            >
              <SendIcon className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
