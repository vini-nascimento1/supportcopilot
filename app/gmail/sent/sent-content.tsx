"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { HistoryIcon, ExternalLinkIcon, Trash2Icon, RefreshCwIcon, GlobeIcon, LockIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type SentEmail = {
  id: string
  template_name: string
  recipient: string
  cc: string | null
  user_email: string | null
  subject: string
  gmail_thread_id: string | null
  visibility: string
  sent_by: string
  created_at: string
}

// null = single-row removal, count = bulk removal of the current selection.
type Confirm = { kind: "single"; id: string } | { kind: "bulk"; count: number } | null

export default function SentPage({ currentEmail }: { currentEmail: string | null }) {
  const [sent, setSent] = useState<SentEmail[]>([])
  const [loading, setLoading] = useState(true)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [deleting, setDeleting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const masterRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  // The server only lets you delete your OWN records (sent_by), so selection is
  // limited to those — shared entries authored by others are view-only here.
  const canDelete = useCallback(
    (s: SentEmail) => currentEmail != null && s.sent_by === currentEmail,
    [currentEmail]
  )

  const fetchSent = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/gmail/sent")
      if (!res.ok) throw new Error("Failed to load")
      const data = (await res.json()) as SentEmail[]
      setSent(data)
      // Drop any selected ids that are gone or no longer owned after the refetch.
      const owned = new Set(data.filter(canDelete).map((s) => s.id))
      setSelected((prev) => {
        if (prev.size === 0) return prev
        const next = new Set<string>()
        for (const id of prev) if (owned.has(id)) next.add(id)
        return next.size === prev.size ? prev : next
      })
    } catch {
      toast.error("Failed to load sent emails")
    } finally {
      setLoading(false)
    }
  }, [canDelete])

  useEffect(() => { fetchSent() }, [fetchSent])

  const ownedIds = useMemo(() => sent.filter(canDelete).map((s) => s.id), [sent, canDelete])

  const allSelected = ownedIds.length > 0 && selected.size === ownedIds.length
  const someSelected = selected.size > 0 && !allSelected

  // Set the tri-state in an effect (not during render) to keep hooks lint happy.
  useEffect(() => {
    if (masterRef.current) masterRef.current.indeterminate = someSelected
  }, [someSelected])

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelected((prev) => (prev.size === ownedIds.length ? new Set() : new Set(ownedIds)))
  }, [ownedIds])

  async function handleConfirm() {
    if (!confirm) return
    setDeleting(true)
    try {
      if (confirm.kind === "single") {
        const res = await fetch(`/api/gmail/sent/${confirm.id}`, { method: "DELETE" })
        if (!res.ok) throw new Error("Delete failed")
        toast.success("Entry removed")
      } else {
        const ids = Array.from(selected)
        const res = await fetch("/api/gmail/sent", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        })
        if (!res.ok) throw new Error("Delete failed")
        const { deleted } = (await res.json()) as { deleted: number }
        toast.success(`${deleted} ${deleted === 1 ? "entry" : "entries"} removed`)
        setSelected(new Set())
      }
      setConfirm(null)
      await fetchSent()
    } catch {
      toast.error("Failed to delete")
    } finally {
      setDeleting(false)
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
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirm({ kind: "bulk", count: selected.size })}
              disabled={deleting}
            >
              <Trash2Icon className="mr-1 size-4" />
              Delete selected ({selected.size})
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={fetchSent} disabled={loading}>
            <RefreshCwIcon className={`mr-1 size-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
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
          {/* Select-all row (only when there are entries you can remove) */}
          {ownedIds.length > 0 && (
            <div className="flex items-center gap-3 px-3 py-1">
              <input
                ref={masterRef}
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="size-4 shrink-0 cursor-pointer rounded border-muted-foreground/40 accent-primary"
                aria-label="Select all"
              />
              <span className="text-xs text-muted-foreground">
                {selected.size > 0 ? `${selected.size} of ${ownedIds.length} selected` : "Select all"}
              </span>
            </div>
          )}

          {sent.map((s) => {
            const isShared = s.visibility === "shared"
            const deletable = canDelete(s)
            const isSelected = selected.has(s.id)
            return (
              <div
                key={s.id}
                className={`flex items-start gap-3 rounded-lg border p-3 ${isSelected ? "bg-accent/50" : ""}`}
              >
                {/* Selection checkbox — only for your own entries */}
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={!deletable}
                  onChange={() => toggle(s.id)}
                  className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-muted-foreground/40 accent-primary disabled:cursor-not-allowed disabled:opacity-30"
                  title={deletable ? "Select" : "Shared by someone else — only the sender can remove it"}
                  aria-label="Select entry"
                />

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase">
                      {s.template_name}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(s.created_at).toLocaleString()}
                    </span>
                    <span
                      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        isShared
                          ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {isShared ? <GlobeIcon className="size-2.5" /> : <LockIcon className="size-2.5" />}
                      {isShared ? "Shared" : "Private"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium truncate">{s.subject}</p>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span>To: {s.recipient}</span>
                    {s.cc && <span>CC: {s.cc}</span>}
                    {s.user_email && <span>User: {s.user_email}</span>}
                    <span>By: {s.sent_by}</span>
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
                    onClick={() => setConfirm({ kind: "single", id: s.id })}
                    disabled={!deletable}
                    title={deletable ? "Remove from tracker" : "Only the sender can remove this"}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Confirm delete dialog (single or bulk) */}
      <Dialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm?.kind === "bulk" ? `Remove ${confirm.count} entries?` : "Remove entry?"}
            </DialogTitle>
            <DialogDescription>
              {confirm?.kind === "bulk"
                ? `Remove ${confirm.count} selected ${confirm.count === 1 ? "entry" : "entries"} from the tracker? (The emails in Gmail will NOT be deleted)`
                : "Remove this entry from the tracker? (The email in Gmail will NOT be deleted)"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirm} disabled={deleting}>
              {deleting ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
