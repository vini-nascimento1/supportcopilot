"use client"

import { useSyncExternalStore } from "react"

// Global notification center — the single place anything in the app notifies
// the agent. Separate from and additive to sonner toasts (ephemeral,
// per-action feedback — untouched).
//
// This store powers a bell icon mounted globally (see
// components/notifications/notification-bell.tsx) plus a floating toast
// stack for brand-new arrivals (notification-toasts.tsx). It's a plain
// module-level pub/sub so any part of the app can call `pushNotification(...)`
// without importing React or a Provider.
//
// The store itself has no backend and resets on reload. Server-sourced
// notifications (automation `alert.in_app` matches) are polled into it by
// components/notifications/automation-alert-sync.ts, which passes a stable
// `id` so repeated polls don't duplicate, plus `alertId` so the bell can mark
// the underlying row read in Supabase. Unread alerts survive a reload because
// the server keeps them until they're actually read.

export type NotificationType = "info" | "success" | "warning" | "error"

export interface AppNotification {
  id: string
  title: string
  message?: string
  type: NotificationType
  createdAt: number
  read: boolean
  /** How long the floating toast stays up before auto-fading, in ms. */
  durationMs: number
  /** `automation_alerts.id` when this came from a rule; absent for local pushes. */
  alertId?: string
  /** Optional click-through (e.g. the Intercom conversation that matched). */
  href?: string
}

export interface PushNotificationInput {
  title: string
  message?: string
  type?: NotificationType
  /** Overrides DEFAULT_TOAST_DURATION_MS for this one notification. */
  durationMs?: number
  /**
   * Stable id for de-duplication. Pass this for anything polled from the
   * server: pushing the same id twice is a no-op, even after the
   * notification has been dismissed.
   */
  id?: string
  /** `automation_alerts.id` — lets the bell mark the source row read. */
  alertId?: string
  /** Optional click-through URL. */
  href?: string
  /** Add to history without popping a floating toast (used when hydrating). */
  silent?: boolean
  /** Overrides the arrival time (server rows carry their own created_at). */
  createdAt?: number
}

export const MAX_HISTORY = 50
export const DEFAULT_TOAST_DURATION_MS = 6000

const EMPTY_NOTIFICATIONS: AppNotification[] = []
const EMPTY_TOASTS: AppNotification[] = []

let notifications: AppNotification[] = EMPTY_NOTIFICATIONS
let toasts: AppNotification[] = EMPTY_TOASTS

type Listener = () => void
const listeners = new Set<Listener>()

function emit() {
  for (const listener of listeners) listener()
}

let counter = 0
function nextId(): string {
  counter += 1
  return `notif-${Date.now()}-${counter}`
}

// Every id this tab has ever pushed, including dismissed ones. Polled
// server notifications are re-offered on every tick, so without this a
// dismissed alert would reappear seconds later. Capped so a long-lived tab
// can't grow it without bound.
const MAX_SEEN_IDS = 500
const seenIds = new Set<string>()

function rememberId(id: string) {
  seenIds.add(id)
  if (seenIds.size > MAX_SEEN_IDS) {
    const overflow = seenIds.size - MAX_SEEN_IDS
    let dropped = 0
    for (const old of seenIds) {
      seenIds.delete(old)
      if (++dropped >= overflow) break
    }
  }
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getNotifications(): AppNotification[] {
  return notifications
}

function getToasts(): AppNotification[] {
  return toasts
}

function getServerNotifications(): AppNotification[] {
  return EMPTY_NOTIFICATIONS
}

function getServerToasts(): AppNotification[] {
  return EMPTY_TOASTS
}

/**
 * Push a new notification. Adds it to history (capped at MAX_HISTORY, most
 * recent first) AND shows it as a floating toast near the bell. Returns the
 * notification's id (e.g. to dismiss it programmatically).
 *
 * Pass `input.id` for anything that can be offered more than once (polled
 * server rows): a repeat push with a known id is a no-op and just returns
 * that id.
 *
 * Plain function — no hooks required, safe to call from anywhere (event
 * handlers, effects, server-driven features, etc).
 */
export function pushNotification(input: PushNotificationInput): string {
  const id = input.id ?? nextId()
  if (seenIds.has(id)) return id
  rememberId(id)

  const notif: AppNotification = {
    id,
    title: input.title,
    message: input.message,
    type: input.type ?? "info",
    createdAt: input.createdAt ?? Date.now(),
    read: false,
    durationMs: input.durationMs ?? DEFAULT_TOAST_DURATION_MS,
    alertId: input.alertId,
    href: input.href,
  }
  notifications = [notif, ...notifications]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_HISTORY)
  if (!input.silent) toasts = [...toasts, notif]
  emit()
  return id
}

/** Removes a notification from the floating toast stack (history untouched). */
export function dismissToast(id: string): void {
  if (!toasts.some((t) => t.id === id)) return
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

/** Removes a notification from history entirely (also clears any live toast). */
export function dismissNotification(id: string): void {
  let changed = false
  if (notifications.some((n) => n.id === id)) {
    notifications = notifications.filter((n) => n.id !== id)
    changed = true
  }
  if (toasts.some((t) => t.id === id)) {
    toasts = toasts.filter((t) => t.id !== id)
    changed = true
  }
  if (changed) emit()
}

/**
 * Empties history and the floating toast stack — what the bell's "Dismiss all"
 * calls. Toasts go too: leaving them hovering after the agent just cleared
 * everything reads as the button not having worked.
 */
export function clearAllNotifications(): void {
  if (notifications.length === 0 && toasts.length === 0) return
  notifications = EMPTY_NOTIFICATIONS
  toasts = EMPTY_TOASTS
  emit()
}

export function markNotificationRead(id: string): void {
  const idx = notifications.findIndex((n) => n.id === id)
  if (idx === -1 || notifications[idx].read) return
  notifications = notifications.map((n) => (n.id === id ? { ...n, read: true } : n))
  emit()
}

export function markAllNotificationsRead(): void {
  if (notifications.every((n) => n.read)) return
  notifications = notifications.map((n) => (n.read ? n : { ...n, read: true }))
  emit()
}

export interface UseNotificationsResult {
  notifications: AppNotification[]
  toasts: AppNotification[]
  unreadCount: number
  pushNotification: typeof pushNotification
  dismissNotification: typeof dismissNotification
  dismissToast: typeof dismissToast
  markNotificationRead: typeof markNotificationRead
  markAllNotificationsRead: typeof markAllNotificationsRead
  clearAllNotifications: typeof clearAllNotifications
}

export function useNotifications(): UseNotificationsResult {
  const list = useSyncExternalStore(subscribe, getNotifications, getServerNotifications)
  const toastList = useSyncExternalStore(subscribe, getToasts, getServerToasts)
  const unreadCount = list.reduce((n, item) => (item.read ? n : n + 1), 0)

  return {
    notifications: list,
    toasts: toastList,
    unreadCount,
    pushNotification,
    dismissNotification,
    dismissToast,
    markNotificationRead,
    markAllNotificationsRead,
    clearAllNotifications,
  }
}
