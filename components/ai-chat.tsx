"use client"

import { useRef, useState } from "react"
import { BotIcon, SendIcon, XIcon } from "lucide-react"
import ReactMarkdown from "react-markdown"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Message = {
  id: string
  role: "user" | "assistant"
  content: string
}

let msgCounter = 0
function nextId(): string {
  return `msg-${++msgCounter}-${Date.now()}`
}

const MAX_MESSAGES = 50

export function AIChat() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const abortRef = useRef<AbortController | null>(null)

  function scrollToBottom() {
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" })
    })
  }

  async function send() {
    const text = input.trim()
    if (!text || loading) return
    setInput("")
    setError(null)

    abortRef.current?.abort()
    const abort = new AbortController()
    abortRef.current = abort

    const userMsg: Message = { id: nextId(), role: "user", content: text }
    const updated = [...messages, userMsg]
    setMessages(updated)
    setLoading(true)
    scrollToBottom()

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updated.map(({ role, content }) => ({ role, content })) }),
        signal: abort.signal,
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Something went wrong")
        setLoading(false)
        scrollToBottom()
        return
      }
      const assistantMsg: Message = { id: nextId(), role: "assistant", content: data.message }
      setMessages((prev) => [...prev, assistantMsg].slice(-MAX_MESSAGES))
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return
      setError("Network error. Check your connection.")
    }

    setLoading(false)
    scrollToBottom()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <>
      {/* FAB button */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 z-50 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-all hover:scale-105 hover:shadow-xl active:scale-95"
        aria-label={open ? "Close AI chat" : "Open AI chat"}
      >
        {open ? <XIcon className="size-5" /> : <BotIcon className="size-5" />}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-22 right-6 z-50 flex w-[380px] flex-col rounded-xl border bg-card shadow-2xl transition-all duration-200 animate-in slide-in-from-bottom-4">
          {/* Header */}
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <BotIcon className="size-4 text-primary" />
            <span className="text-sm font-semibold">AI Assistant</span>
          </div>

          {/* Messages */}
          <div
            ref={listRef}
            className="flex max-h-[400px] min-h-[250px] flex-col gap-3 overflow-y-auto p-4"
          >
            {messages.length === 0 && !loading && (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-center text-sm text-muted-foreground">
                  Ask me anything about your automation.
                  <br />
                  <span className="text-xs">
                    Create rules, test conditions, get insights.
                  </span>
                </p>
              </div>
            )}

            {messages.map((m) => (
              <div
                key={m.id}
                className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "mr-auto bg-muted"
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
            ))}

            {loading && (
              <div className="mr-auto flex items-center gap-1.5 rounded-xl bg-muted px-3 py-2">
                <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
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
              placeholder="Ask anything..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            <Button
              onClick={send}
              disabled={loading || !input.trim()}
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
