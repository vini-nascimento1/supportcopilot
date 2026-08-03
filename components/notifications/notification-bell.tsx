"use client"

// Global notification bell — fixed top-right on every page (mounted once in
// app/layout.tsx). Separate from sonner (ephemeral action toasts). Backed by
// lib/notifications-store.ts, plus automation rule alerts polled in by
// components/notifications/automation-alert-sync.ts — this bell is the only
// place automation alerts surface, there is no separate alerts page.

import { useState } from "react"
import {
  AlertTriangleIcon,
  BellIcon,
  CheckCheckIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  InfoIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn, relativeTime } from "@/lib/utils"
import {
  type AppNotification,
  type NotificationType,
  useNotifications,
} from "@/lib/notifications-store"
import { markAlertsRead, useAutomationAlertSync } from "./automation-alert-sync"

const TYPE_ICON: Record<NotificationType, typeof InfoIcon> = {
  info: InfoIcon,
  success: CheckCircle2Icon,
  warning: AlertTriangleIcon,
  error: XCircleIcon,
}

const TYPE_CLASS: Record<NotificationType, string> = {
  info: "text-blue-500",
  success: "text-emerald-500",
  warning: "text-amber-500",
  error: "text-destructive",
}

function NotificationRow({
  notification,
  onDismiss,
}: {
  notification: AppNotification
  onDismiss: (id: string) => void
}) {
  const Icon = TYPE_ICON[notification.type]
  // Alerts carry a link to the conversation that matched; plain pushes don't.
  const Body = notification.href ? "a" : "div"
  return (
    <li
      className={cn(
        "group relative flex items-start rounded-md hover:bg-muted",
        !notification.read && "bg-muted/50"
      )}
    >
      <Body
        {...(notification.href
          ? { href: notification.href, target: "_blank", rel: "noreferrer" }
          : {})}
        className="flex min-w-0 flex-1 items-start gap-2 rounded-md p-2 pr-7"
      >
        <Icon className={cn("mt-0.5 size-4 shrink-0", TYPE_CLASS[notification.type])} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 truncate text-sm font-medium text-foreground">
            {notification.title}
            {notification.href && <ExternalLinkIcon className="size-3 shrink-0 opacity-60" />}
          </p>
          {notification.message && (
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {notification.message}
            </p>
          )}
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {relativeTime(new Date(notification.createdAt).toISOString())}
          </p>
        </div>
      </Body>
      <button
        type="button"
        onClick={() => onDismiss(notification.id)}
        aria-label="Dismiss notification"
        className="absolute top-2 right-1.5 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100"
      >
        <XIcon className="size-3.5" />
      </button>
    </li>
  )
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const {
    notifications,
    unreadCount,
    dismissNotification,
    markAllNotificationsRead,
    clearAllNotifications,
    pushNotification,
  } = useNotifications()

  // Streams automation rule alerts into this bell (see automation-alert-sync).
  useAutomationAlertSync()

  const alertIds = (list: AppNotification[]) =>
    list.map((n) => n.alertId).filter((id): id is string => Boolean(id))

  // Reading/dismissing has to reach the server too, otherwise the next poll
  // serves the same alert straight back.
  function handleDismiss(id: string) {
    const target = notifications.find((n) => n.id === id)
    dismissNotification(id)
    if (target?.alertId) void markAlertsRead([target.alertId])
  }

  function handleDismissAll() {
    const ids = alertIds(notifications)
    clearAllNotifications()
    void markAlertsRead(ids)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) return
        markAllNotificationsRead()
        void markAlertsRead(alertIds(notifications.filter((n) => !n.read)))
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications"}
          className="fixed top-4 right-4 z-50 flex size-10 items-center justify-center rounded-full border bg-card shadow-lg ring-1 ring-foreground/10 transition-all hover:scale-105 hover:shadow-xl active:scale-95"
        >
          <BellIcon className="size-4.5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-4.5 min-w-4.5 justify-center rounded-full px-1 text-[10px] tabular-nums"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-80 gap-0 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {notifications.length > 0 && (
            <button
              type="button"
              onClick={handleDismissAll}
              aria-label={`Dismiss all ${notifications.length} notifications`}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <CheckCheckIcon className="size-3.5" />
              Dismiss all
            </button>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto p-1.5">
          {notifications.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs text-muted-foreground">
              No notifications yet
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {notifications.map((n) => (
                <NotificationRow key={n.id} notification={n} onDismiss={handleDismiss} />
              ))}
            </ul>
          )}
        </div>

        {process.env.NODE_ENV !== "production" && (
          <div className="border-t p-1.5">
            <button
              type="button"
              onClick={() =>
                pushNotification({
                  title: "Test notification",
                  message: "This is a dev-only test — click the X or wait for it to fade.",
                  type: (["info", "success", "warning", "error"] as const)[
                    Math.floor(Math.random() * 4)
                  ],
                })
              }
              className="w-full rounded-md px-2 py-1.5 text-center text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Send test notification (dev only)
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
