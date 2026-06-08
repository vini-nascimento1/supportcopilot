"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { HistoryIcon, ExternalLinkIcon, Trash2Icon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

type SentEmail = {
  id: string
  template_name: string
  recipient: string
  user_email: string | null
  subject: string
  gmail_thread_id: string | null
  created_at: string
}

export default function SentPage() {
  const [sent, setSent] = useState<SentEmail[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  const fetchSent = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/gmail/sent")
      if (!res.ok) throw new Error("Failed to load")
      const data = (await res.json()) as SentEmail[]
      setSent(data)
    } catch {
      toast.error("Failed to load sent emails")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSent() }, [fetchSent])

  async function handleDelete(id: string) {
    if (!confirm("Remove this entry from the tracker? (The email in Gmail will NOT be deleted)")) return
    try {
      const res = await fetch(`/api/gmail/sent/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Delete failed")
      toast.success("Entry removed")
      await fetchSent()
    } catch {
      toast.error("Failed to delete")
    }
  }

  function gmailThreadUrl(threadId: string): string {
    return `https://mail.google.com/mail/u/0/#inbox/${threadId}`
  }

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HistoryIcon className="size-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Sent Tracker</h2>
        </div>
        <Button variant="outline" size="sm" onClick={fetchSent} disabled={loading}>
          <RefreshCwIcon className={`mr-1 size-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* List */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : sent.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <HistoryIcon className="size-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No sent emails yet</p>
          <Button variant="outline" size="sm" onClick={() => router.push("/gmail/quick-send")}>
            Send your first template email
          </Button>
        </div>
      ) : (
        <div className="grid gap-2">
          {sent.map((s) => (
            <div key={s.id} className="flex items-start gap-3 rounded-lg border p-3">
              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground uppercase">
                    {s.template_name}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(s.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 text-sm font-medium truncate">{s.subject}</p>
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span>To: {s.recipient}</span>
                  {s.user_email && <span>User: {s.user_email}</span>}
                </div>
              </div>

              {/* Actions */}
              <div className="flex shrink-0 gap-1">
                {s.gmail_thread_id && (
                  <a
                    href={gmailThreadUrl(s.gmail_thread_id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    title="Open in Gmail"
                  >
                    <ExternalLinkIcon className="size-3.5" />
                  </a>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive"
                  onClick={() => handleDelete(s.id)}
                  title="Remove from tracker"
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
