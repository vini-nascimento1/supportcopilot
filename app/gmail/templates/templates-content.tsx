"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { FileTextIcon, PlusIcon, PencilIcon, Trash2Icon, XIcon, CheckIcon, UsersIcon, AtSignIcon, BracketsIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"

const PLACEHOLDERS = ["{{useremail}}"] as const

type Template = {
  id: string
  name: string
  recipient: string
  cc: string | null
  access_emails: string | null
  subject: string
  body: string
  created_at: string
  updated_at: string
}

const emptyForm = { name: "", recipient: "", cc: "", access_emails: "", subject: "", body: "" }

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const subjectRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  function insertAtCursor(
    ref: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
    field: "subject" | "body",
    text: string
  ) {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart ?? form[field].length
    const end = el.selectionEnd ?? form[field].length
    const newVal = form[field].slice(0, start) + text + form[field].slice(end)
    setForm({ ...form, [field]: newVal })
    // Restore cursor position after the inserted text on next tick
    requestAnimationFrame(() => {
      const pos = start + text.length
      el.setSelectionRange(pos, pos)
      el.focus()
    })
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

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm)
    setDialogOpen(true)
  }

  function openEdit(t: Template) {
    setEditingId(t.id)
    setForm({
      name: t.name,
      recipient: t.recipient,
      cc: t.cc ?? "",
      access_emails: t.access_emails ?? "",
      subject: t.subject,
      body: t.body,
    })
    setDialogOpen(true)
  }

  async function handleSave() {
    if (!form.name || !form.recipient || !form.subject || !form.body) {
      toast.error("Name, recipient, subject and body are required")
      return
    }
    setSaving(true)
    try {
      const url = editingId ? `/api/gmail/templates/${editingId}` : "/api/gmail/templates"
      const method = editingId ? "PUT" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error("Save failed")
      setDialogOpen(false)
      toast.success(editingId ? "Template updated" : "Template created")
      await fetchTemplates()
    } catch {
      toast.error("Failed to save template")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this template?")) return
    try {
      const res = await fetch(`/api/gmail/templates/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Delete failed")
      toast.success("Template deleted")
      await fetchTemplates()
    } catch {
      toast.error("Failed to delete template")
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileTextIcon className="size-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Email Templates</h2>
        </div>
        <Button onClick={openCreate} size="sm">
          <PlusIcon className="mr-1 size-4" />
          New Template
        </Button>
      </div>

      {/* List */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <FileTextIcon className="size-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No templates yet</p>
          <Button variant="outline" size="sm" onClick={openCreate}>
            Create your first template
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {templates.map((t) => (
            <div
              key={t.id}
              className="flex flex-col gap-2 rounded-lg border p-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-medium">{t.name}</h3>
                  <p className="text-xs text-muted-foreground">
                    To: {t.recipient}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(t)}>
                    <PencilIcon className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-8 text-destructive" onClick={() => handleDelete(t.id)}>
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                {t.cc && <span className="flex items-center gap-1"><AtSignIcon className="size-3" />CC: {t.cc}</span>}
                {t.access_emails && <span className="flex items-center gap-1"><UsersIcon className="size-3" />Access: {t.access_emails}</span>}
              </div>
              <div className="rounded-md bg-muted p-2 text-xs">
                <p className="font-mono text-muted-foreground">Subject: {t.subject}</p>
                <p className="mt-1 font-mono text-muted-foreground line-clamp-2">{t.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Template" : "New Template"}</DialogTitle>
            <DialogDescription>
              Use {"{{useremail}}"} as a placeholder for the customer email.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 max-h-[70vh] overflow-y-auto pr-1">
            <div>
              <Label>Template Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Bank Statement Update"
              />
            </div>
            <div>
              <Label>Default Recipient (To)</Label>
              <Input
                value={form.recipient}
                onChange={(e) => setForm({ ...form, recipient: e.target.value })}
                placeholder="e.g. partner@fanvue.com"
              />
            </div>
            <div>
              <Label>CC (optional)</Label>
              <Input
                value={form.cc}
                onChange={(e) => setForm({ ...form, cc: e.target.value })}
                placeholder="Comma-separated emails, e.g. manager@fanvue.com"
              />
              <p className="mt-0.5 text-xs text-muted-foreground">
                Always CC these recipients when sending
              </p>
            </div>
            <div>
              <Label>Who can view (optional)</Label>
              <Input
                value={form.access_emails}
                onChange={(e) => setForm({ ...form, access_emails: e.target.value })}
                placeholder="Comma-separated agent emails"
              />
              <p className="mt-0.5 text-xs text-muted-foreground">
                Agents who can see threads from this template. Leave empty = only you.
              </p>
            </div>
            <div>
              <Label>Subject</Label>
              <Input
                ref={subjectRef}
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                placeholder="Re: Bank statement for {{useremail}}"
              />
            </div>
            <div>
              <div className="flex items-center gap-1 mb-1.5">
                <Label className="mb-0">Body</Label>
                <span className="text-xs text-muted-foreground">· Click a placeholder to insert at cursor</span>
              </div>
              <div className="flex flex-wrap gap-1 mb-2">
                {PLACEHOLDERS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      // Insert into whichever field was last focused
                      if (document.activeElement === bodyRef.current) {
                        insertAtCursor(bodyRef, "body", p)
                      } else {
                        insertAtCursor(subjectRef, "subject", p)
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded-md border bg-muted/50 px-2 py-0.5 text-xs font-mono text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    <BracketsIcon className="size-3" />
                    {p}
                  </button>
                ))}
              </div>
              <Textarea
                ref={bodyRef}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                rows={8}
                placeholder="Hello, I'm reaching out about user {{useremail}}..."
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                <XIcon className="mr-1 size-4" />
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                <CheckIcon className="mr-1 size-4" />
                {saving ? "Saving..." : editingId ? "Update" : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
