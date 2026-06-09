"use client"

import { useRef, useState } from "react"
import { PaperclipIcon, SendIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

type Props = {
  threadId: string
  to: string
  subject: string
  inReplyTo: string | null
  references: string | null
  onSent?: () => void
}

type SelectedFile = {
  file: File
  id: string
}

export function GmailReply({ threadId, to, subject, inReplyTo, references, onSent }: Props) {
  const [body, setBody] = useState("")
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState("")
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    const newFiles = files.map((file) => ({
      file,
      id: `${file.name}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    }))
    setSelectedFiles((prev) => [...prev, ...newFiles])
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function removeFile(id: string) {
    setSelectedFiles((prev) => prev.filter((f) => f.id !== id))
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  async function handleSend() {
    if (!body.trim()) return
    setStatus("sending")
    setErrorMsg("")

    try {
      const hasFiles = selectedFiles.length > 0

      let res: Response
      if (hasFiles) {
        const formData = new FormData()
        formData.append("to", to)
        formData.append("subject", subject)
        formData.append("body", body.trim())
        formData.append("threadId", threadId)
        if (inReplyTo) formData.append("inReplyTo", inReplyTo)
        formData.append(
          "references",
          references
            ? `${references} ${inReplyTo ?? ""}`.trim()
            : (inReplyTo ?? "")
        )
        for (const sf of selectedFiles) {
          formData.append("attachments", sf.file)
        }
        res = await fetch("/api/gmail/send", { method: "POST", body: formData })
      } else {
        res = await fetch("/api/gmail/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to,
            subject,
            body: body.trim(),
            threadId,
            inReplyTo: inReplyTo ?? undefined,
            references: references
              ? `${references} ${inReplyTo ?? ""}`.trim()
              : (inReplyTo ?? undefined),
          }),
        })
      }

      const data = (await res.json()) as { error?: string }
      if (!res.ok) {
        setStatus("error")
        setErrorMsg(data.error ?? "Send failed")
        return
      }
      setStatus("sent")
      setBody("")
      setSelectedFiles([])
      onSent?.()
    } catch (e) {
      setStatus("error")
      setErrorMsg(e instanceof Error ? e.message : "Network error")
    }
  }

  if (status === "sent") {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
        <span>✓</span>
        <span>Reply sent.</span>
        <button
          onClick={() => setStatus("idle")}
          className="ml-auto text-xs underline hover:no-underline"
        >
          Write another
        </button>
      </div>
    )
  }

  return (
    <div className="mt-4 flex flex-col gap-2 rounded-lg border bg-muted/20 p-4">
      <p className="text-xs font-medium text-muted-foreground">
        Reply to <span className="font-semibold text-foreground">{to}</span>
      </p>

      <Textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write your reply…"
        className="min-h-32 resize-y bg-background text-sm"
        disabled={status === "sending"}
      />

      {/* Attachments */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileSelect}
            className="hidden"
            disabled={status === "sending"}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={status === "sending"}
          >
            <PaperclipIcon className="size-3.5" />
            Attach files
          </Button>
          {selectedFiles.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {selectedFiles.length} file{selectedFiles.length > 1 ? "s" : ""}
            </span>
          )}
        </div>

        {selectedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selectedFiles.map((sf) => (
              <div
                key={sf.id}
                className="flex items-center gap-1 rounded-md border bg-background px-2 py-0.5 text-xs"
              >
                <span className="max-w-36 truncate">{sf.file.name}</span>
                <span className="text-muted-foreground">({formatSize(sf.file.size)})</span>
                <button
                  type="button"
                  onClick={() => removeFile(sf.id)}
                  className="ml-0.5 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  disabled={status === "sending"}
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {status === "error" && (
        <p className="text-xs text-destructive">{errorMsg}</p>
      )}

      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={handleSend}
          disabled={!body.trim() || status === "sending"}
        >
          <SendIcon className="size-3.5" />
          {status === "sending" ? "Sending…" : "Send reply"}
        </Button>
      </div>
    </div>
  )
}
