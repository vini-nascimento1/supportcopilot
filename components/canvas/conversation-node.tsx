"use client"

import { useState } from "react"
import { NodeResizer, type Node, type NodeProps } from "@xyflow/react"
import { CheckIcon, MessageSquareIcon } from "lucide-react"

import { PinButton } from "@/components/canvas/pin-button"

export interface ConversationMessageData {
  role: "customer" | "admin" | "ai"
  author: string
  body: string
  createdAt: string | null
}

export type ConversationData = {
  subject: string | null
  messages: ConversationMessageData[]
}

export type ConversationNodeType = Node<ConversationData, "conversation">

// One message bubble — click anywhere on it to copy the text (same pattern
// as the Case Info fields).
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
      className={
        "nodrag cursor-pointer rounded-lg px-2.5 py-1.5 text-left transition-colors " +
        (msg.role === "customer"
          ? "mr-4 bg-muted hover:bg-muted/70"
          : "ml-4 bg-primary/10 hover:bg-primary/20")
      }
    >
      <p className="mb-0.5 flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
        {msg.author}
        {msg.createdAt &&
          ` · ${new Date(msg.createdAt).toLocaleString("en-GB", { timeZone: "Europe/London" })}`}
        {copied && (
          <span className="ml-auto flex items-center gap-0.5 text-emerald-500">
            <CheckIcon className="size-3" /> copied
          </span>
        )}
      </p>
      <p className="whitespace-pre-wrap text-xs leading-snug">{msg.body}</p>
    </button>
  )
}

// The Intercom thread as a canvas card — the whole case can be worked
// (read → copy → check tools → draft) without leaving the canvas.
export function ConversationNode({ id, data, selected }: NodeProps<ConversationNodeType>) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border bg-card shadow-md">
      <NodeResizer isVisible={selected} minWidth={300} minHeight={220} />
      <div className="flex h-9 shrink-0 cursor-grab items-center gap-2 border-b bg-muted/50 px-3 active:cursor-grabbing">
        <MessageSquareIcon className="size-3.5 text-muted-foreground" />
        <span className="truncate text-xs font-medium">
          {data.subject || "Conversation"}
        </span>
        <span className="nodrag ml-auto">
          <PinButton nodeId={id} />
        </span>
      </div>
      <div className="nodrag nowheel flex flex-1 flex-col gap-3 overflow-y-auto p-3">
        {data.messages.length === 0 && (
          <p className="m-auto text-xs text-muted-foreground">No messages.</p>
        )}
        {data.messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}
      </div>
    </div>
  )
}
