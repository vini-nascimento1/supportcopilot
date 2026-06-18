"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { AtSignIcon, PaperclipIcon, SendIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"

type SelectedFile = {
  file: File
  id: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function ComposeForm() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [toChips, setToChips] = useState<string[]>([])
  const [pendingTo, setPendingTo] = useState("")
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([])
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle")
  const [error, setError] = useState("")

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return

    const newFiles = files.map((file) => ({
      file,
      id: `${file.name}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    }))
    setSelectedFiles((prev) => [...prev, ...newFiles])

    // Reset the input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function removeFile(id: string) {
    setSelectedFiles((prev) => prev.filter((f) => f.id !== id))
  }

  function commitTo(raw: string): boolean {
    const candidate = raw.trim().replace(/,+$/, "").trim()
    if (!candidate) return false
    if (!EMAIL_RE.test(candidate)) return false
    setToChips((prev) =>
      prev.some((e) => e.toLowerCase() === candidate.toLowerCase()) ? prev : [...prev, candidate]
    )
    return true
  }

  function removeToChip(email: string) {
    setToChips((prev) => prev.filter((e) => e !== email))
  }

  function handleToKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      if (commitTo(pendingTo)) setPendingTo("")
    } else if (e.key === "Backspace" && !pendingTo && toChips.length > 0) {
      setToChips((prev) => prev.slice(0, -1))
    }
  }

  function handleToPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text")
    if (!/[\s,;]/.test(text)) return
    e.preventDefault()
    const parts = text.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean)
    setToChips((prev) => {
      const next = [...prev]
      for (const p of parts) {
        if (EMAIL_RE.test(p) && !next.some((x) => x.toLowerCase() === p.toLowerCase())) {
          next.push(p)
        }
      }
      return next
    })
    setPendingTo("")
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  async function handleSend() {
    let finalTo = toChips
    const pending = pendingTo.trim().replace(/,+$/, "").trim()
    if (pending) {
      if (EMAIL_RE.test(pending) && !finalTo.some((e) => e.toLowerCase() === pending.toLowerCase())) {
        finalTo = [...finalTo, pending]
      }
      setToChips(finalTo)
      setPendingTo("")
    }

    if (finalTo.length === 0 || !subject.trim() || !body.trim()) return
    const toJoined = finalTo.join(", ")

    setStatus("sending")
    setError("")

    try {
      const hasFiles = selectedFiles.length > 0

      let res: Response
      if (hasFiles) {
        // Send as FormData when there are attachments
        const formData = new FormData()
        formData.append("to", toJoined)
        formData.append("subject", subject.trim())
        formData.append("body", body.trim())
        for (const sf of selectedFiles) {
          formData.append("attachments", sf.file)
        }
        res = await fetch("/api/gmail/send", { method: "POST", body: formData })
      } else {
        res = await fetch("/api/gmail/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: toJoined, subject: subject.trim(), body: body.trim() }),
        })
      }

      const data = (await res.json()) as { error?: string }
      if (!res.ok) {
        setStatus("error")
        setError(data.error ?? "Send failed")
        return
      }
      setStatus("sent")
      setTimeout(() => router.push("/gmail"), 1500)
    } catch (e) {
      setStatus("error")
      setError(e instanceof Error ? e.message : "Network error")
    }
  }

  if (status === "sent") {
    return (
      <main className="flex flex-col gap-4 p-4 lg:p-6">
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <span className="text-4xl">✓</span>
          <p className="font-medium">Message sent!</p>
          <p className="text-sm text-muted-foreground">Redirecting to inbox…</p>
        </div>
      </main>
    )
  }

  return (
    <main className="flex flex-col gap-4 p-4 lg:p-6">
      <div className="flex flex-col gap-1.5">
        <Label>To</Label>
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 focus-within:ring-1 focus-within:ring-ring">
          {toChips.map((email) => (
            <span
              key={email}
              className="flex items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 text-xs"
            >
              <AtSignIcon className="size-3 shrink-0 text-muted-foreground" />
              <span className="max-w-48 truncate">{email}</span>
              <button
                type="button"
                onClick={() => removeToChip(email)}
                className="ml-0.5 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                disabled={status === "sending"}
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
          <input
            value={pendingTo}
            onChange={(e) => setPendingTo(e.target.value)}
            onKeyDown={handleToKeyDown}
            onPaste={handleToPaste}
            onBlur={() => { if (pendingTo.trim() && commitTo(pendingTo)) setPendingTo("") }}
            placeholder={toChips.length === 0 ? "recipient@example.com" : "Add another…"}
            disabled={status === "sending"}
            className="min-w-40 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="subject">Subject</Label>
        <Input
          id="subject"
          placeholder="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          disabled={status === "sending"}
        />
      </div>

      <Separator />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="body">Message</Label>
        <Textarea
          id="body"
          placeholder="Write your message…"
          className="min-h-56 resize-y"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={status === "sending"}
        />
      </div>

      {/* Attachments */}
      <div className="flex flex-col gap-2">
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
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={status === "sending"}
          >
            <PaperclipIcon className="size-4" />
            Attach files
          </Button>
          {selectedFiles.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {selectedFiles.length} file{selectedFiles.length > 1 ? "s" : ""} selected
            </span>
          )}
        </div>

        {selectedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {selectedFiles.map((sf) => (
              <div
                key={sf.id}
                className="flex items-center gap-1.5 rounded-md border bg-muted/30 px-2.5 py-1 text-xs"
              >
                <span className="max-w-48 truncate">{sf.file.name}</span>
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
        <p className="text-sm text-destructive">{error}</p>
      )}

      <div className="flex justify-end">
        <Button
          onClick={handleSend}
          disabled={(toChips.length === 0 && !pendingTo.trim()) || !subject.trim() || !body.trim() || status === "sending"}
        >
          <SendIcon className="size-4" />
          {status === "sending" ? "Sending…" : "Send"}
        </Button>
      </div>
    </main>
  )
}
