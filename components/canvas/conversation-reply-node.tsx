"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  NodeResizer,
  useReactFlow,
  type Node,
  type NodeProps,
} from "@xyflow/react"
import {
  BrainIcon,
  CheckIcon,
  MessageSquareIcon,
  PaperclipIcon,
  RefreshCwIcon,
} from "lucide-react"

import { PinButton } from "@/components/canvas/pin-button"
import { ComposerBar } from "@/components/canvas/composer-bar"
import { CopilotPanel } from "@/components/canvas/copilot-panel"
import { useReplyComposer } from "@/components/canvas/use-reply-composer"
import { cn } from "@/lib/utils"

export interface ConversationMessageData {
  role: "customer" | "admin" | "ai"
  author: string
  body: string
  createdAt: string | null
  attachmentCount?: number
}

type CopilotMessage = { role: "user" | "assistant"; content: string }

export type ConversationReplyData = {
  subject: string | null
  messages: ConversationMessageData[]
  conversationId: string
  playbookId?: string
  playbookName?: string
  copilotTranscript?: CopilotMessage[]
}

export type ConversationReplyNodeType = Node<
  ConversationReplyData,
  "conversation"
>

const POLL_MS = 15_000

function MessageBubble({ msg }: { msg: ConversationMessageData }) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    void navigator.clipboard.writeText(msg.body)
    setCopied(true)
    setTimeout(() => setCopied(false), 1000)
  }

  return (
    <button
      onClick={copy}
      title="Click to copy"
      className={cn(
        "nodrag cursor-pointer rounded-lg px-2.5 py-1.5 text-left transition-colors",
        msg.role === "customer"
          ? "mr-4 bg-muted hover:bg-muted/70"
          : "ml-4 bg-primary/10 hover:bg-primary/20"
      )}
    >
      <p className="mb-0.5 flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
        <span className="truncate">{msg.author}</span>
        {msg.createdAt && (
          <span>
            &middot;{" "}
            {new Date(msg.createdAt).toLocaleString("en-GB", {
              timeZone: "Europe/London",
            })}
          </span>
        )}
        {copied && (
          <span className="ml-auto flex items-center gap-0.5 text-emerald-500">
            <CheckIcon className="size-3" /> copied
          </span>
        )}
      </p>
      {msg.body.trim() && (
        <p className="text-xs leading-snug whitespace-pre-wrap">{msg.body}</p>
      )}
      {!!msg.attachmentCount && (
        <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
          <PaperclipIcon className="size-3" />
          {msg.attachmentCount} attachment{msg.attachmentCount === 1 ? "" : "s"}
        </p>
      )}
    </button>
  )
}

export function ConversationReplyNode({
  id,
  data,
  selected,
}: NodeProps<ConversationReplyNodeType>) {
  const { updateNodeData } = useReactFlow()
  const [showCopilot, setShowCopilot] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [pendingSuggestion, setPendingSuggestion] = useState<{
    id: string
    riskBand?: string | null
  } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const prefilledRef = useRef(false)

  const refreshThread = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await fetch(
        `/api/canvas/conversation?id=${encodeURIComponent(data.conversationId)}`
      )
      if (!res.ok) return
      const json = (await res.json()) as {
        conversation?: {
          subject: string | null
          messages: ConversationMessageData[]
        }
      }
      if (json.conversation?.messages) {
        updateNodeData(id, {
          subject: json.conversation.subject,
          messages: json.conversation.messages,
        })
      }
    } finally {
      setRefreshing(false)
    }
  }, [data.conversationId, id, updateNodeData])

  const composer = useReplyComposer({
    conversationId: data.conversationId,
    playbookId: data.playbookId,
    suggestionId: pendingSuggestion?.id ?? null,
    riskBand: pendingSuggestion?.riskBand ?? null,
    onSent: () => {
      void refreshThread()
    },
  })
  const prefillComposer = composer.prefill

  useEffect(() => {
    if (prefilledRef.current) return
    prefilledRef.current = true
    void (async () => {
      try {
        const res = await fetch(
          `/api/reply-queue/for-conversation?conversationId=${encodeURIComponent(
            data.conversationId
          )}`
        )
        if (!res.ok) return
        const json = (await res.json()) as {
          suggestion?: {
            id: string
            body: string
            riskBand?: string | null
          } | null
        }
        if (json.suggestion?.body) {
          setPendingSuggestion({
            id: json.suggestion.id,
            riskBand: json.suggestion.riskBand,
          })
          prefillComposer(json.suggestion.body)
        }
      } catch {
        // No queued suggestion; start with an empty composer.
      }
    })()
  }, [data.conversationId, prefillComposer])

  useEffect(() => {
    const tick = () => {
      if (!document.hidden) void refreshThread()
    }
    const timer = setInterval(tick, POLL_MS)
    return () => clearInterval(timer)
  }, [refreshThread])

  useEffect(() => {
    requestAnimationFrame(() =>
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
    )
  }, [data.messages.length])

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border bg-card shadow-md">
      <NodeResizer isVisible={selected} minWidth={340} minHeight={360} />
      <div className="flex h-9 shrink-0 cursor-grab items-center gap-2 border-b bg-muted/50 px-3 active:cursor-grabbing">
        <MessageSquareIcon className="size-3.5 text-muted-foreground" />
        <span className="truncate text-xs font-medium">
          {data.subject || "Conversation"}
        </span>
        <span className="nodrag ml-auto flex items-center gap-1">
          <button
            onClick={() => void refreshThread()}
            title="Refresh thread"
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <RefreshCwIcon
              className={cn("size-3.5", refreshing && "animate-spin")}
            />
          </button>
          <button
            onClick={() => setShowCopilot((open) => !open)}
            title="Copilot"
            className={cn(
              "flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] transition-colors",
              showCopilot
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <BrainIcon className="size-3.5" />
            Copilot
          </button>
          <PinButton nodeId={id} />
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            ref={listRef}
            className="nodrag nowheel flex flex-1 flex-col gap-3 overflow-y-auto p-3"
          >
            {data.messages.length === 0 && (
              <p className="m-auto text-xs text-muted-foreground">
                No messages.
              </p>
            )}
            {data.messages.map((msg, index) => (
              <MessageBubble
                key={`${msg.createdAt ?? "msg"}-${index}`}
                msg={msg}
              />
            ))}
          </div>
          <ComposerBar composer={composer} />
        </div>
        {showCopilot && (
          <div className="w-72 shrink-0 border-l">
            <CopilotPanel
              conversationId={data.conversationId}
              transcript={data.copilotTranscript ?? []}
              onTranscript={(transcript) =>
                updateNodeData(id, { copilotTranscript: transcript })
              }
            />
          </div>
        )}
      </div>
    </div>
  )
}
