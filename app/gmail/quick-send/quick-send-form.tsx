"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { SendIcon, ArrowLeftIcon, EyeIcon, EyeOffIcon, GlobeIcon, LockIcon, AtSignIcon, PaperclipIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type SelectedFile = {
  file: File
  id: string
}

type Template = {
  id: string
  name: string
  recipient: string
  cc: string | null
  access_emails: string | null
  subject: string
  body: string
}

function fillPlaceholders(text: string, userEmail: string, agentName: string): string {
  return text
    .replace(/\{\{useremail\}\}/gi, userEmail)
    .replace(/\{\{agentname\}\}/gi, agentName)
}

export default function QuickSendPage({ agentName }: { agentName: string | null }) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("")
  const [userEmail, setUserEmail] = useState("")
  const [recipient, setRecipient] = useState("")
  const [cc, setCc] = useState("")
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([])
  const [visibility, setVisibility] = useState("private")
  const [showPreview, setShowPreview] = useState(false)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

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

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/gmail/templates")
      if (!res.ok) throw new Error("Failed to load")
      const data = (await res.json()) as Template[]
      setTemplates(data)
    } catch {
      toast.error("Failed to load templates")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchTemplates() }, [fetchTemplates])

  function handleSelectTemplate(id: string) {
    setSelectedTemplateId(id)
    const t = templates.find((t) => t.id === id)
    if (!t) return
    setRecipient(t.recipient)
    setCc(t.cc ?? "")
    setSubject(t.subject)
    setBody(t.body)
  }

  function getPreviewText(text: string): string {
    return fillPlaceholders(text, userEmail || "{{useremail}}", agentName || "{{agentname}}")
  }

  async function handleSend() {
    if (!recipient || !subject || !body) {
      toast.error("Please fill in all fields")
      return
    }
    if (!userEmail) {
      toast.error("Please enter the customer email")
      return
    }

    setSending(true)
    try {
      const template = templates.find((t) => t.id === selectedTemplateId)

      const resolvedSubject = fillPlaceholders(subject, userEmail, agentName ?? "")
      const resolvedBody = fillPlaceholders(body, userEmail, agentName ?? "")

      const hasFiles = selectedFiles.length > 0

      let res: Response
      if (hasFiles) {
        const formData = new FormData()
        formData.append("to", recipient)
        formData.append("subject", resolvedSubject)
        formData.append("body", resolvedBody)
        if (cc) formData.append("cc", cc)
        for (const sf of selectedFiles) {
          formData.append("attachments", sf.file)
        }
        res = await fetch("/api/gmail/send", { method: "POST", body: formData })
      } else {
        res = await fetch("/api/gmail/quick-send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateId: selectedTemplateId,
            templateName: template?.name ?? "Manual",
            recipient,
            cc: cc || undefined,
            userEmail,
            subject: resolvedSubject,
            body: resolvedBody,
            visibility,
          }),
        })
      }
      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        throw new Error(err.error ?? "Send failed")
      }

      // Best-effort tracking when files were sent via /api/gmail/send
      if (hasFiles) {
        const data = (await res.json()) as { messageId?: string; threadId?: string }
        fetch("/api/gmail/quick-send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateId: selectedTemplateId,
            templateName: template?.name ?? "Manual",
            recipient,
            cc: cc || undefined,
            userEmail,
            subject: resolvedSubject,
            body: resolvedBody,
            visibility,
            messageId: data.messageId,
            threadId: data.threadId,
          }),
        }).catch(() => {})
      }

      setSent(true)
      toast.success("Email sent!")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send")
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <span className="text-4xl">✓</span>
        <p className="font-medium">Email sent!</p>
        <p className="text-sm text-muted-foreground">
          To: {recipient} &middot; User: {userEmail}
        </p>
        <div className="flex gap-2 mt-2">
          <Button variant="outline" size="sm" onClick={() => router.push("/gmail/sent")}>
            View sent tracker
          </Button>
          <Button size="sm" onClick={() => { setSent(false); setSelectedTemplateId(""); setUserEmail(""); setRecipient(""); setCc(""); setSubject(""); setBody(""); setSelectedFiles([]); setVisibility("private") }}>
            Send another
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="size-8" onClick={() => router.back()}>
          <ArrowLeftIcon className="size-4" />
        </Button>
        <h2 className="text-lg font-semibold">Quick Send</h2>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading templates...</p>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="text-sm text-muted-foreground">No templates found</p>
          <Button variant="outline" size="sm" onClick={() => router.push("/gmail/templates")}>
            Create templates first
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4 max-w-xl">
          {/* Template Select */}
          <div>
            <Label>Template</Label>
            <Select value={selectedTemplateId} onValueChange={handleSelectTemplate}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a template..." />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedTemplateId && (
            <>
              {/* User Email */}
              <div>
                <Label>Customer Email</Label>
                <Input
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                  placeholder="user@example.com"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {"{{useremail}}"} is replaced with the email above; {"{{agentname}}"} with your name
                </p>
              </div>

              {/* Recipient */}
              <div>
                <Label>To</Label>
                <Input
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                />
              </div>

              {/* CC */}
              <div>
                <Label>CC</Label>
                <Input
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder="Comma-separated emails"
                />
              </div>

              {/* Subject */}
              <div>
                <Label>Subject</Label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>

              {/* Body */}
              <div>
                <Label>Body</Label>
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={8}
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
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={sending}
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
                  <div className="flex flex-wrap gap-2">
                    {selectedFiles.map((sf) => (
                      <div
                        key={sf.id}
                        className="flex items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1 text-xs"
                      >
                        <PaperclipIcon className="size-3 shrink-0" />
                        <span className="max-w-40 truncate">{sf.file.name}</span>
                        <span className="shrink-0 text-muted-foreground">
                          ({formatSize(sf.file.size)})
                        </span>
                        <button
                          onClick={() => removeFile(sf.id)}
                          className="ml-0.5 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                          disabled={sending}
                        >
                          <XIcon className="size-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Visibility */}
              <div>
                <Label>Thread Visibility</Label>
                <div className="flex gap-2 mt-1">
                  <Button
                    type="button"
                    variant={visibility === "private" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setVisibility("private")}
                    className="flex items-center gap-1.5"
                  >
                    <LockIcon className="size-3.5" />
                    Private
                  </Button>
                  <Button
                    type="button"
                    variant={visibility === "shared" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setVisibility("shared")}
                    className="flex items-center gap-1.5"
                  >
                    <GlobeIcon className="size-3.5" />
                    Shared
                  </Button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {visibility === "private"
                    ? "Only you can see this thread in the sent tracker"
                    : "Everyone with access to this template can see this thread"}
                </p>
              </div>

              {/* Preview */}
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowPreview(!showPreview)}
                >
                  {showPreview ? <EyeOffIcon className="mr-1 size-4" /> : <EyeIcon className="mr-1 size-4" />}
                  {showPreview ? "Hide preview" : "Show preview"}
                </Button>
                {showPreview && (
                  <div className="mt-2 rounded-md border bg-muted p-3 text-sm">
                    <p><strong>To:</strong> {recipient}</p>
                    {cc && <p><strong>CC:</strong> {cc}</p>}
                    <p><strong>Subject:</strong> {getPreviewText(subject)}</p>
                    <pre className="mt-2 whitespace-pre-wrap font-sans text-muted-foreground">
                      {getPreviewText(body)}
                    </pre>
                  </div>
                )}
              </div>

              {/* Send */}
              <Button onClick={handleSend} disabled={sending || !userEmail}>
                <SendIcon className="mr-2 size-4" />
                {sending ? "Sending..." : "Send Email"}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
