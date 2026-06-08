"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { SendIcon, ArrowLeftIcon, EyeIcon, EyeOffIcon } from "lucide-react"
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

type Template = {
  id: string
  name: string
  recipient: string
  subject: string
  body: string
}

function fillPlaceholders(text: string, userEmail: string): string {
  return text.replace(/\{\{useremail\}\}/gi, userEmail)
}

export default function QuickSendPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("")
  const [userEmail, setUserEmail] = useState("")
  const [recipient, setRecipient] = useState("")
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [showPreview, setShowPreview] = useState(false)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

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
    // Reset user email, keep subject/body as template (unfilled)
    setSubject(t.subject)
    setBody(t.body)
  }

  function getPreviewText(text: string): string {
    return fillPlaceholders(text, userEmail || "{{useremail}}")
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
      const res = await fetch("/api/gmail/quick-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: selectedTemplateId,
          templateName: template?.name ?? "Manual",
          recipient,
          userEmail,
          subject: fillPlaceholders(subject, userEmail),
          body: fillPlaceholders(body, userEmail),
        }),
      })
      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        throw new Error(err.error ?? "Send failed")
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
          <Button size="sm" onClick={() => { setSent(false); setSelectedTemplateId(""); setUserEmail(""); setRecipient(""); setSubject(""); setBody("") }}>
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
                  This replaces {"{{useremail}}"} in the template
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
