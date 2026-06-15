"use client"

import { useRef, useState } from "react"
import { NodeResizer, useReactFlow, type Node, type NodeProps } from "@xyflow/react"
import { BotIcon, CheckIcon, CopyIcon, Loader2Icon, SendIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MarkdownPreview } from "@/components/markdown-preview"
import { PinButton } from "@/components/canvas/pin-button"

type Message = { role: "user" | "assistant"; content: string }

// Copy-to-clipboard button shown on hover over a message. Click copies the
// raw message text (markdown source for assistant answers).
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1000)
      }}
      title="Copy message"
      className="nodrag shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover/msg:opacity-100"
    >
      {copied ? (
        <CheckIcon className="size-3 text-emerald-500" />
      ) : (
        <CopyIcon className="size-3" />
      )}
    </button>
  )
}

export type AiNodeData = {
  /** When set, the assistant is a copilot for THIS ticket: full conversation
      + matched playbooks in context (via /api/ai/case-chat). */
  conversationId?: string
  /** Persisted transcript — written back into node data so the canvas layout
      save (localStorage) restores it after a reload, not just across tab
      switches. */
  messages?: Message[]
}

export type AiNodeType = Node<AiNodeData, "ai">

// AI assistant as a canvas card. On a case canvas it's a case copilot — the
// open ticket and its playbooks ARE its context, so "summarise the case"
// means this case. On ad-hoc canvases it falls back to the general assistant.
export function AiNode({ id, data, selected }: NodeProps<AiNodeType>) {
  const { updateNodeData } = useReactFlow()
  // Seed from persisted data so a reload (or returning to a kept-alive pane)
  // restores the transcript; thereafter local state is the source of truth and
  // every change is mirrored back into node data via updateNodeData.
  const [messages, setMessages] = useState<Message[]>(() => data.messages ?? [])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const persist = (next: Message[]) => {
    setMessages(next)
    updateNodeData(id, { messages: next })
  }

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return
    setInput("")
    setError(null)
    const updated: Message[] = [...messages, { role: "user", content: text }]
    persist(updated)
    setLoading(true)
    try {
      const endpoint = data.conversationId ? "/api/ai/case-chat" : "/api/ai/chat"
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updated,
          conversationId: data.conversationId,
        }),
      })
      const payload = await res.json()
      if (!res.ok) {
        setError(payload.error ?? "Something went wrong")
      } else {
        persist([...updated, { role: "assistant", content: payload.message }])
      }
    } catch {
      setError("Network error. Check your connection.")
    }
    setLoading(false)
    requestAnimationFrame(() =>
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight }),
    )
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border bg-card shadow-md">
      <NodeResizer isVisible={selected} minWidth={300} minHeight={260} />
      <div className="flex h-9 shrink-0 cursor-grab items-center gap-2 border-b bg-muted/50 px-3 active:cursor-grabbing">
        <BotIcon className="size-3.5 text-primary" />
        <span className="text-xs font-medium">
          {data.conversationId ? "Case copilot" : "AI Assistant"}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {loading && (
            <Loader2Icon className="size-3 animate-spin text-muted-foreground" />
          )}
          <PinButton nodeId={id} />
        </span>
      </div>
      <div
        ref={listRef}
        className="nodrag nowheel flex flex-1 cursor-auto flex-col gap-2 overflow-y-auto p-3 select-text"
      >
        {messages.length === 0 && !loading && (
          <p className="m-auto text-center text-xs text-muted-foreground">
            {data.conversationId
              ? "This assistant knows the full ticket and its playbooks.\nTry: “summarise the case”, “what should I check?”"
              : "Ask anything while you work."}
          </p>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div
              key={i}
              className="group/msg flex items-start gap-1 self-end"
            >
              <div className="ml-6 select-text rounded-lg bg-primary px-2.5 py-1.5 text-xs text-primary-foreground">
                {m.content}
              </div>
              <CopyButton text={m.content} />
            </div>
          ) : (
            // The model answers in markdown — render it properly
            <div
              key={i}
              className="group/msg flex items-start gap-1 self-start"
            >
              <div className="mr-1 select-text [&_.markdown-preview]:text-xs">
                <MarkdownPreview content={m.content} />
              </div>
              <CopyButton text={m.content} />
            </div>
          ),
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
      <div className="nodrag flex shrink-0 items-center gap-1.5 border-t p-2">
        <Input
          className="h-7 text-xs"
          placeholder={
            data.conversationId ? "Ask about this case…" : "Ask the assistant…"
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              void send()
            }
          }}
        />
        <Button
          size="icon"
          className="size-7 shrink-0"
          onClick={() => void send()}
          disabled={loading || !input.trim()}
        >
          <SendIcon className="size-3" />
        </Button>
      </div>
    </div>
  )
}
