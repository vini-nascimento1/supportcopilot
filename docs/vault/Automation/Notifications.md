---
title: Notifications
tags: [notifications, ui, automation]
updated: 2026-08-03
---

# Notifications

There are two notification-shaped UIs in the app:

1. **The global notification bell + history dropdown + floating toasts** — a bell icon fixed to every page, described below. This is the app-wide notification center, and the only place automation-rule alerts surface.
2. **`components/update-banner.tsx`** — an unrelated app-version update banner, not a user-facing notification at all.

> **Changed 2026-08-03.** The Automation page used to carry a separate "Alerts" tab, which meant a rule match only existed somewhere you had to go looking for it. That tab is gone: `alert.in_app` now rings the bell. The `automation_alerts` table and `/api/automation/alerts` still exist — they're the delivery + read-state backend behind the bell.

## The global notification bell

Mounted once in `app/layout.tsx`, under `components/notifications/` + `lib/notifications-store.ts`. Four pieces:

### Store: `lib/notifications-store.ts`

A plain, in-memory, module-level pub/sub store. It is intentionally framework-light: `pushNotification()` is an exported plain function (not a hook), so any code anywhere in the app can call it directly without needing a React context or provider.

State is split into two lists:

- `notifications` — the history list, capped at `MAX_HISTORY = 50`, most recent first (sorted by `createdAt`).
- `toasts` — the subset currently showing as floating toast popups.

`pushNotification({ title, message?, type?, durationMs?, id?, alertId?, href?, silent?, createdAt? })` adds the item to both lists (`type` defaults to `"info"`; `durationMs` defaults to `DEFAULT_TOAST_DURATION_MS = 6000`ms). The fields that exist for server-sourced notifications:

- `id` — a **stable** id. Pushing an id that has already been seen is a no-op, even after it was dismissed, so a polling caller can re-offer the same row on every tick without duplicating it. Tracked in a `seenIds` set capped at `MAX_SEEN_IDS = 500`.
- `alertId` — the `automation_alerts.id` this came from, so the bell can mark that row read server-side.
- `href` — optional click-through (the Intercom conversation that matched).
- `silent` — add to history without popping a toast; used when hydrating on page load.
- `createdAt` — arrival time override, so a server row keeps its real timestamp.

Other exports: `dismissToast(id)` (removes only from the floating stack), `dismissNotification(id)` (removes from history and any live toast), `markNotificationRead(id)`, `markAllNotificationsRead()`, `clearAllNotifications()` (empties history **and** the floating toast stack — a "dismiss all" that left toasts hovering would read as broken).

The `useNotifications()` hook subscribes a component to the store via `useSyncExternalStore`, exposing `notifications`, `toasts`, `unreadCount`, and all the mutator functions above.

Note the store itself is still client-only and resets on reload. Persistence for automation alerts comes from the server (see below), not from here.

### Alert sync: `components/notifications/automation-alert-sync.ts`

`useAutomationAlertSync()` — mounted by the bell — polls `GET /api/automation/alerts` every 45s, plus immediately on mount and whenever the tab becomes visible again. Each unread row is pushed into the store with `id: "alert:<row id>"`, the rule name as the title and the alert body as the message, `type: "warning"`.

The **first successful poll is silent**: on a fresh page load the bell is repopulated from the server without firing a burst of toasts for alerts already seen. Every poll after that toasts new arrivals.

Read state lives on the server (`automation_alerts.read_at`), so unread alerts survive a reload. `markAlertsRead(ids)` (exported from the same module) `PATCH`es the endpoint; that's what actually stops an alert coming back. The store's `seenIds` covers the gap within the current tab.

A 401 (signed out) or a network blip just skips that tick.

### Bell: `components/notifications/notification-bell.tsx`

`NotificationBell` renders as a fixed circular button (`fixed top-4 right-4`) with an unread-count badge, and opens a `Popover` history dropdown on click. The dropdown lists all notifications (newest first) with type icon, title, message, and relative timestamp. Rows with an `href` render as a link to the Intercom conversation, marked with an external-link icon.

Read/dismiss actions are mirrored to the server for anything carrying an `alertId`:

- Opening the popover → `markAllNotificationsRead()` + `markAlertsRead()` for the previously-unread ones.
- Dismissing a row → `dismissNotification()` + `markAlertsRead([alertId])`.
- "Dismiss all" (header, shown only when the list is non-empty) → `clearAllNotifications()` + `markAlertsRead()` for everything in the list. Clears history and any live toasts in one click.

In non-production builds only, a "Send test notification" button is shown for manual testing.

### Toasts: `components/notifications/notification-toasts.tsx`

`NotificationToasts`, also mounted globally in `app/layout.tsx`, renders the floating toast stack just under the bell (`fixed top-16 right-4`). Each toast auto-fades after its `durationMs` (default 6s) via a `closing` state that animates opacity/translate, with a timer fallback (not just `onTransitionEnd`) so a toast can't linger stuck if the CSS transition never fires (e.g. backgrounded tab, reduced motion). Multiple toasts stack vertically. A toast can also be dismissed early with its X button.

### Relationship to sonner

The bell/toast system is separate from and additive to **sonner toasts** (`<Toaster />` in `app/layout.tsx`) — ephemeral, per-action feedback (e.g. "Draft sent", "Copied to clipboard"). Untouched by this feature.

## Backend: `automation_alerts` + `/api/automation/alerts`

Automation rules whose action is `alert.in_app` (or `alert.slack` falling back to in-app when no Slack target resolves) write rows to `automation_alerts` — see [[Automation Rules Engine]] and [[Database Schema Reference]]. The table has a nullable `read_at` timestamp, not a boolean `read`, and a `(rule_id, case_id, kind)` upsert so a monitor re-running every 5 min doesn't pile up duplicates.

`GET /api/automation/alerts` returns unread alerts for the signed-in agent's own rules (`?all=1` includes read ones), joining `cases(intercom_conversation_id)` to add a `url` per alert — the deep link the bell uses. `PATCH` with `{ ids: [...] }` sets `read_at`, scoped to alerts belonging to that agent's rules.

## Update banner (unrelated)

`components/update-banner.tsx` renders `UpdateBanner`, also mounted globally in `app/layout.tsx`. It polls `/version.json` every 5 minutes and shows a dismissible banner when the deployed build's git SHA changes, prompting the agent to refresh. This is an app-version notice, not a user notification — it shares no code or store with the bell/toast system above.

## Key files

- `lib/notifications-store.ts` — the in-memory pub/sub store, `pushNotification()`, `useNotifications()`, stable-id de-dupe
- `components/notifications/automation-alert-sync.ts` — `useAutomationAlertSync()` polling + `markAlertsRead()`
- `components/notifications/notification-bell.tsx` — `NotificationBell`, fixed icon + history dropdown
- `components/notifications/notification-toasts.tsx` — `NotificationToasts`, floating auto-fading toast stack
- `app/layout.tsx` — mounts `NotificationBell` and `NotificationToasts` globally, alongside sonner's `<Toaster />` and `UpdateBanner`
- `app/api/automation/alerts/route.ts` — GET unread alerts (with conversation `url`), PATCH mark read
- `lib/automation/actions.ts` — the `alert.in_app` handler that writes the row
- `components/automation-client.tsx` — Automation page, rule list only (no alerts tab)
- `components/update-banner.tsx` — app-version update banner (unrelated system)

## Data flow

```
Local pushes (in-memory only):
any code in the app → pushNotification({ title, message?, type?, durationMs? })
  → adds to `notifications` (history, capped 50) and `toasts` (floating stack)
  → useSyncExternalStore re-renders NotificationBell (badge/dropdown) and NotificationToasts

Automation alerts (server-backed, same bell):
rule matches → alert.in_app action → upsert row in automation_alerts (read_at = null)
  → useAutomationAlertSync polls GET /api/automation/alerts (45s / on focus)
  → pushNotification({ id: "alert:<id>", alertId, href, silent: first pass })
  → bell badge + floating toast; row links to the Intercom conversation
  → agent opens bell / dismisses / clears → PATCH /api/automation/alerts → read_at set
  → alert stops being served; unread ones survive a page reload
```

## Related pages

[[Automation Rules Engine]] · [[Tech Stack]] · [[Database Schema Reference]] · [[Slack Integration]]
