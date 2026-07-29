"use client"

import { useSyncExternalStore } from "react"

// Global, in-memory notification center. Separate from and additive to:
//   - sonner toasts (ephemeral, per-action feedback — untouched)
//   - the Automation page's "Alerts" tab (scoped to automation-rule matches,
//     backed by /api/automation/alerts — untouched)
//
// This store powers a bell icon mounted globally (see
// components/notifications/notification-bell.tsx) plus a floating toast
// stack for brand-new arrivals (notification-toasts.tsx). It's a plain
// module-level pub/sub so any part of the app can call `pushNotification(...)`
// without importing React or a Provider — no backend, resets on reload.

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
}

export interface PushNotificationInput {
  title: string
  message?: string
  type?: NotificationType
  /** Overrides DEFAULT_TOAST_DURATION_MS for this one notification. */
  durationMs?: number
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
 * new notification's id (e.g. to dismiss it programmatically).
 *
 * Plain function — no hooks required, safe to call from anywhere (event
 * handlers, effects, future server-driven features, etc).
 */
export function pushNotification(input: PushNotificationInput): string {
  const id = nextId()
  const notif: AppNotification = {
    id,
    title: input.title,
    message: input.message,
    type: input.type ?? "info",
    createdAt: Date.now(),
    read: false,
    durationMs: input.durationMs ?? DEFAULT_TOAST_DURATION_MS,
  }
  notifications = [notif, ...notifications].slice(0, MAX_HISTORY)
  toasts = [...toasts, notif]
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

export function clearAllNotifications(): void {
  if (notifications.length === 0) return
  notifications = EMPTY_NOTIFICATIONS
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
