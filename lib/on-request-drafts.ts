"use client"

const KEY = "fv-on-request-drafts"
const EVENT = "fv-on-request-drafts-changed"
const TTL_MS = 20 * 60 * 1000

export type PendingOnRequestDraft = {
  conversationId: string
  customerName: string | null
  subject: string | null
  requestedAt: string
}

function nowMs() {
  return Date.now()
}

function isFresh(item: PendingOnRequestDraft, atMs = nowMs()) {
  const requestedAt = Date.parse(item.requestedAt)
  return Number.isFinite(requestedAt) && atMs - requestedAt <= TTL_MS
}

function emit() {
  try {
    window.dispatchEvent(new Event(EVENT))
  } catch {
    // SSR / no window
  }
}

function write(items: PendingOnRequestDraft[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.filter((item) => isFresh(item))))
  } catch {
    // ignore storage failures
  }
  emit()
}

export function readPendingOnRequestDrafts(): PendingOnRequestDraft[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]")
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is PendingOnRequestDraft => {
        if (typeof item !== "object" || item === null) return false
        const row = item as Partial<PendingOnRequestDraft>
        return typeof row.conversationId === "string" && typeof row.requestedAt === "string"
      })
      .filter((item) => isFresh(item))
  } catch {
    return []
  }
}

export function addPendingOnRequestDrafts(items: Array<Omit<PendingOnRequestDraft, "requestedAt">>) {
  if (items.length === 0) return
  const requestedAt = new Date().toISOString()
  const byId = new Map(readPendingOnRequestDrafts().map((item) => [item.conversationId, item]))
  for (const item of items) {
    byId.set(item.conversationId, { ...item, requestedAt })
  }
  write([...byId.values()])
}

export function removePendingOnRequestDrafts(conversationIds: string[]) {
  if (conversationIds.length === 0) return
  const ids = new Set(conversationIds)
  write(readPendingOnRequestDrafts().filter((item) => !ids.has(item.conversationId)))
}

export function subscribePendingOnRequestDrafts(cb: () => void) {
  window.addEventListener(EVENT, cb)
  window.addEventListener("storage", cb)
  return () => {
    window.removeEventListener(EVENT, cb)
    window.removeEventListener("storage", cb)
  }
}
