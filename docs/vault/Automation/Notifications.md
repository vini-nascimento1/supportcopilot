---
title: Notifications
tags: [notifications, ui, automation]
updated: 2026-07-29
---

# Notifications

There are three distinct, independent notification-shaped UIs in the app. It's easy to conflate them, so this page keeps them separate:

1. **The global notification bell + history dropdown + floating toasts** — a bell icon fixed to every page, described below. This is the app-wide notification center.
2. **The Automation page's "Alerts" tab** — scoped only to automation-rule matches (see [[Automation Rules Engine]]).
3. **`components/update-banner.tsx`** — an unrelated app-version update banner, not a user-facing notification at all.

## The global notification bell (landed)

As of this writing the bell feature has already landed in the codebase (found under `components/notifications/` and `lib/notifications-store.ts`, wired into `app/layout.tsx`). It consists of three pieces:

### Store: `lib/notifications-store.ts`

A plain, in-memory, module-level pub/sub store — no backend, no persistence, resets on page reload. It is intentionally framework-light: `pushNotification()` is an exported plain function (not a hook), so any code anywhere in the app can call it directly without needing a React context or provider.

State is split into two lists:

- `notifications` — the history list, capped at `MAX_HISTORY = 50`, most recent first.
- `toasts` — the subset currently showing as floating toast popups.

Calling `pushNotification({ title, message?, type?, durationMs? })` adds the new item to both lists at once (`type` defaults to `"info"`; `durationMs` defaults to `DEFAULT_TOAST_DURATION_MS = 6000`ms). Other exports: `dismissToast(id)` (removes only from the floating stack), `dismissNotification(id)` (removes from history and any live toast), `markNotificationRead(id)`, `markAllNotificationsRead()`, `clearAllNotifications()`.

The `useNotifications()` hook subscribes a component to the store via `useSyncExternalStore`, exposing `notifications`, `toasts`, `unreadCount`, and all the mutator functions above.

### Bell: `components/notifications/notification-bell.tsx`

A `NotificationBell` component rendered once, globally, in `app/layout.tsx`. It renders as a fixed circular button (`fixed top-4 right-4`) with an unread-count badge, and opens a `Popover` history dropdown on click. Opening the popover calls `markAllNotificationsRead()`. The dropdown lists all notifications (newest first) with type icon, title, message, and relative timestamp; each row can be dismissed individually, or the whole history cleared with one "Clear all" action. In non-production builds only, a "Send test notification" button is shown for manual testing.

### Toasts: `components/notifications/notification-toasts.tsx`

A `NotificationToasts` component, also mounted globally in `app/layout.tsx`, renders the floating toast stack just under the bell (`fixed top-16 right-4`). Each toast auto-fades after its `durationMs` (default 6s) via a `closing` state that animates opacity/translate, with a timer fallback (not just `onTransitionEnd`) so a toast can't linger stuck if the CSS transition never fires (e.g. backgrounded tab, reduced motion). Multiple toasts stack vertically. A toast can also be dismissed early with its X button.

### Relationship to sonner and to Automation Alerts

The store's own header comment is explicit about this: the bell/toast system is separate from **and additive to**:

- **sonner toasts** (`<Toaster />` in `app/layout.tsx`) — ephemeral, per-action feedback (e.g. "Draft sent", "Copied to clipboard"). Untouched by this feature.
- **the Automation page's "Alerts" tab** — scoped to automation-rule matches only, backed by the `automation_alerts` table (see below). Untouched by this feature.

Nothing currently wires automation-rule matches or other backend events into `pushNotification()` — as of this writing the store only has the dev-only "Send test notification" button as a caller. It exists as generic, ready-to-use plumbing for any future in-app notification need.

## Automation "Alerts" tab (separate system)

Within `components/automation-client.tsx`, an "Alerts" tab shows pending alerts generated specifically by automation rules whose action is `alert.in_app` or `alert.slack` (see [[Automation Rules Engine]]). This is backed by the `automation_alerts` table (see [[Database Schema Reference]]), which has a `read` boolean column. Marking an alert read happens via a `PATCH` call, separate from the bell's own read-tracking. Fetching pending alerts goes through `POST /api/automation/alerts`.

Do not confuse this tab with the global bell: the Alerts tab only ever shows automation-rule output, scoped to the current agent's rules; the bell can show anything pushed via `pushNotification()` from anywhere in the app.

## Update banner (unrelated)

`components/update-banner.tsx` renders `UpdateBanner`, also mounted globally in `app/layout.tsx`. It polls `/version.json` every 5 minutes and shows a dismissible banner when the deployed build's git SHA changes, prompting the agent to refresh. This is an app-version notice, not a user notification — it shares no code or store with the bell/toast system above.

## Key files

- `lib/notifications-store.ts` — the in-memory pub/sub store, `pushNotification()`, `useNotifications()`
- `components/notifications/notification-bell.tsx` — `NotificationBell`, fixed icon + history dropdown
- `components/notifications/notification-toasts.tsx` — `NotificationToasts`, floating auto-fading toast stack
- `app/layout.tsx` — mounts `NotificationBell` and `NotificationToasts` globally, alongside sonner's `<Toaster />` and `UpdateBanner`
- `components/automation-client.tsx` — Automation page's Alerts tab
- `app/api/automation/alerts/route.ts` — fetch pending automation alerts
- `components/update-banner.tsx` — app-version update banner (unrelated system)

## Data flow

```
Global bell/toast system (in-memory, no backend):
any code in the app → pushNotification({ title, message?, type?, durationMs? })
  → adds to `notifications` (history, capped 50) and `toasts` (floating stack)
  → useSyncExternalStore re-renders NotificationBell (badge/dropdown) and NotificationToasts (floating stack)
  → each toast auto-dismisses after durationMs, or on manual X click
  → opening the bell's dropdown marks all notifications read

Automation Alerts tab (separate, rule-driven):
Automation rule fires alert.in_app / alert.slack action → row written for automation_alerts
  → Automation page Alerts tab → POST /api/automation/alerts (fetch pending)
  → agent marks read → PATCH → automation_alerts.read = true
```

## Related pages

[[Automation Rules Engine]] · [[Tech Stack]] · [[Database Schema Reference]] · [[Slack Integration]]
