"use client"

// Bridges automation rule alerts into the global notification bell.
//
// Automation rules with an `alert.in_app` action write rows to
// `automation_alerts` (see lib/automation/actions.ts). There used to be a
// separate "Alerts" tab on the Automation page for reading them, which meant
// an alert only existed somewhere you had to go looking. Now the bell polls
// this endpoint and every match arrives as a real notification (bell badge +
// floating toast), wherever you are in the app.
//
// Read state lives on the server (`automation_alerts.read_at`), so unread
// alerts survive a reload — the in-memory store is repopulated on the next
// poll. Marking read is what stops an alert coming back; the store's own
// seen-id de-dupe stops it coming back within this tab in the meantime.

import { useEffect } from "react"

import { pushNotification } from "@/lib/notifications-store"

const POLL_MS = 45_000

type AlertRow = {
  id: string
  body: string
  kind: string
  created_at: string
  url?: string | null
  automation_rules?: { name?: string } | null
}

/** Marks alerts read server-side so they stop being served to the bell. */
export async function markAlertsRead(alertIds: string[]): Promise<void> {
  if (alertIds.length === 0) return
  await fetch("/api/automation/alerts", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: alertIds }),
  }).catch(() => {
    // Best-effort: a failed mark-read just means the alert reappears after a
    // reload, which is the safe direction to fail in.
  })
}

/**
 * Polls unread automation alerts into the notification store. Mount once
 * (the bell does it). The first pass is silent — on a fresh page load we
 * repopulate the bell from the server without firing a burst of toasts for
 * alerts the agent has already seen.
 */
export function useAutomationAlertSync(): void {
  useEffect(() => {
    let cancelled = false
    let hydrated = false
    // The bell is mounted globally, including on the signed-out login page,
    // where there is nobody to notify. Stop instead of polling forever —
    // signing in reloads the page, which remounts this. Note proxy.ts sends
    // an unauthenticated request to /login as an HTML 200 rather than a 401,
    // so "signed out" is detected by the response not being JSON.
    let stopped = false

    async function poll() {
      if (stopped) return
      const res = await fetch("/api/automation/alerts").catch(() => null)
      const signedOut =
        res?.status === 401 || !res?.headers.get("content-type")?.includes("application/json")
      if (res && signedOut) {
        stopped = true
        return
      }
      // Network blip / server error: skip this tick, try again next time.
      if (!res?.ok || cancelled) return
      const data = (await res.json().catch(() => null)) as { alerts?: AlertRow[] } | null
      if (!data?.alerts || cancelled) return

      // Oldest first so the store's sort ends up newest-on-top.
      for (const alert of [...data.alerts].reverse()) {
        pushNotification({
          id: `alert:${alert.id}`,
          alertId: alert.id,
          title: alert.automation_rules?.name ?? "Automation alert",
          message: alert.body,
          type: "warning",
          href: alert.url ?? undefined,
          createdAt: new Date(alert.created_at).getTime(),
          silent: !hydrated,
        })
      }
      hydrated = true
    }

    void poll()
    const timer = setInterval(() => void poll(), POLL_MS)
    // Catch up immediately when the agent comes back to the tab.
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll()
    }
    document.addEventListener("visibilitychange", onVisible)

    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [])
}
