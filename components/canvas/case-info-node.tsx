"use client"

import { useState } from "react"
import { useReactFlow, type Node, type NodeProps } from "@xyflow/react"
import {
  CheckIcon,
  ExternalLinkIcon,
  PencilIcon,
  UserIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PinButton } from "@/components/canvas/pin-button"
import { cn } from "@/lib/utils"

export type CaseInfoData = {
  conversationId: string
  customerName: string
  customerEmail: string | null
  state: string
  topic: string | null
  tags: string[]
  intercomUrl: string | null
  /** Agent edits (e.g. customer wrote from a secondary email and sent the
      real one later). Persisted with the canvas layout; live Intercom data
      stays the base. */
  overrides?: {
    customerEmail?: string
    customerName?: string
  }
}

export type CaseInfoNodeType = Node<CaseInfoData, "case-info">

// One field row: click copies the value; fields with onSave are editable
// (pencil → inline input → Enter/blur saves into the node's overrides).
function Field({
  label,
  value,
  mono = false,
  onSave,
}: {
  label: string
  value: string
  mono?: boolean
  onSave?: (next: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  const copy = () => {
    void navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1000)
  }

  const commit = () => {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== value) onSave?.(next)
    else setDraft(value)
  }

  return (
    <div className="group/field flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {editing ? (
        <Input
          autoFocus
          className="nodrag h-6 px-1 text-xs"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit()
            if (e.key === "Escape") {
              setDraft(value)
              setEditing(false)
            }
          }}
        />
      ) : (
        <span className="flex items-center gap-1">
          <button
            className={cn(
              "nodrag truncate text-left text-sm hover:underline",
              mono && "font-mono text-xs",
            )}
            title="Click to copy"
            onClick={copy}
          >
            {value}
          </button>
          {copied && <CheckIcon className="size-3 shrink-0 text-emerald-500" />}
          {onSave && !copied && (
            <button
              className="nodrag shrink-0 opacity-0 transition-opacity group-hover/field:opacity-100"
              title={`Edit ${label.toLowerCase()}`}
              onClick={() => {
                setDraft(value)
                setEditing(true)
              }}
            >
              <PencilIcon className="size-3 text-muted-foreground" />
            </button>
          )}
        </span>
      )}
    </div>
  )
}

function CopyTag({ tag }: { tag: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Badge
      variant="secondary"
      className="nodrag cursor-pointer font-normal"
      title="Click to copy"
      onClick={() => {
        void navigator.clipboard.writeText(tag)
        setCopied(true)
        setTimeout(() => setCopied(false), 1000)
      }}
    >
      {copied ? <CheckIcon className="size-3 text-emerald-500" /> : tag}
    </Badge>
  )
}

// Case snapshot. Live data comes from Intercom; name/email are editable and
// the overrides persist with the canvas layout (the canvas — tool URLs
// included — then uses the corrected values).
export function CaseInfoNode({ id, data }: NodeProps<CaseInfoNodeType>) {
  const { updateNodeData } = useReactFlow()
  const name = data.overrides?.customerName ?? data.customerName
  const email = data.overrides?.customerEmail ?? data.customerEmail

  const saveOverride = (key: "customerName" | "customerEmail", value: string) =>
    updateNodeData(id, {
      overrides: { ...data.overrides, [key]: value },
    })

  return (
    <div className="flex h-full w-full cursor-grab flex-col gap-3 overflow-hidden rounded-xl border bg-card p-4 shadow-md active:cursor-grabbing">
      <div className="flex items-center gap-2">
        <UserIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-semibold">{name}</span>
        <Badge
          variant={data.state === "open" ? "default" : "outline"}
          className="ml-auto shrink-0"
        >
          {data.state}
        </Badge>
        <PinButton nodeId={id} />
      </div>

      <Field
        label="Name"
        value={name}
        onSave={(v) => saveOverride("customerName", v)}
      />
      <Field
        label="Email"
        value={email ?? "—"}
        mono
        onSave={(v) => saveOverride("customerEmail", v)}
      />
      {data.topic && <Field label="Topic" value={data.topic} />}
      {data.tags.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Tags</span>
          <div className="flex flex-wrap gap-1">
            {data.tags.map((tag) => (
              <CopyTag key={tag} tag={tag} />
            ))}
          </div>
        </div>
      )}
      <Field label="Conversation ID" value={data.conversationId} mono />

      {data.intercomUrl && (
        <Button asChild size="sm" variant="outline" className="nodrag mt-auto">
          <a href={data.intercomUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLinkIcon className="size-3.5" />
            Open in Intercom
          </a>
        </Button>
      )}
    </div>
  )
}
