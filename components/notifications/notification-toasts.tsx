"use client"

// Floating toast stack for brand-new notifications — appears just under the
// bell (components/notifications/notification-bell.tsx), auto-fades after
// each notification's durationMs (default 6s, see DEFAULT_TOAST_DURATION_MS
// in lib/notifications-store.ts), or can be dismissed early with the X.
// Multiple notifications stack vertically instead of overlapping. This is
// separate from sonner (mounted as <Toaster/> in app/layout.tsx) — that's
// for ephemeral per-action feedback; this is for the notification center.

import { useEffect, useState } from "react"
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  InfoIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import {
  type AppNotification,
  type NotificationType,
  useNotifications,
} from "@/lib/notifications-store"

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

const FADE_MS = 200

function ToastItem({
  toast,
  onDone,
}: {
  toast: AppNotification
  onDone: (id: string) => void
}) {
  const [closing, setClosing] = useState(false)
  const Icon = TYPE_ICON[toast.type]

  useEffect(() => {
    const timer = setTimeout(() => setClosing(true), toast.durationMs)
    return () => clearTimeout(timer)
  }, [toast.durationMs])

  // onTransitionEnd alone isn't reliable (backgrounded/uncomposited tabs,
  // reduced-motion, etc. can skip the transition entirely) — a timer
  // fallback guarantees the toast is actually removed from the store once
  // it starts closing, instead of lingering invisibly with click-blocking
  // pointer-events. dismissToast() is idempotent so a double-call is safe.
  useEffect(() => {
    if (!closing) return
    const timer = setTimeout(() => onDone(toast.id), FADE_MS + 50)
    return () => clearTimeout(timer)
  }, [closing, toast.id, onDone])

  return (
    <div
      role="status"
      onTransitionEnd={() => {
        if (closing) onDone(toast.id)
      }}
      style={{ transitionDuration: `${FADE_MS}ms` }}
      className={cn(
        "flex w-80 items-start gap-2 rounded-lg border bg-card p-3 shadow-lg ring-1 ring-foreground/10 transition-all ease-in",
        closing
          ? "pointer-events-none translate-x-2 opacity-0"
          : "pointer-events-auto translate-x-0 opacity-100 animate-in fade-in slide-in-from-top-2"
      )}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", TYPE_CLASS[toast.type])} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{toast.title}</p>
        {toast.message && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{toast.message}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => setClosing(true)}
        aria-label="Dismiss"
        className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  )
}

export function NotificationToasts() {
  const { toasts, dismissToast } = useNotifications()

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed top-16 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDone={dismissToast} />
      ))}
    </div>
  )
}
