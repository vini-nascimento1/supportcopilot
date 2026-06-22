"use client"

import { XIcon, FileIcon } from "lucide-react"
import type { ComposerAttachment } from "@/lib/reply-attachments"

export function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: ComposerAttachment[]
  onRemove: (id: string) => void
}) {
  if (attachments.length === 0) return null
  return (
    <div className="nodrag flex flex-wrap gap-1.5 px-1 pb-1">
      {attachments.map((a) => (
        <span
          key={a.id}
          className={
            "flex items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] " +
            (a.tooLarge ? "border-destructive/40 text-destructive" : "bg-muted/40")
          }
          title={a.tooLarge ? `${a.name} - too large (max 10MB)` : a.name}
        >
          {a.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.previewUrl} alt={a.name} className="size-5 rounded object-cover" />
          ) : (
            <FileIcon className="size-3.5" />
          )}
          <span className="max-w-28 truncate">{a.name}</span>
          <button onClick={() => onRemove(a.id)} title="Remove" className="text-muted-foreground hover:text-foreground">
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
    </div>
  )
}
