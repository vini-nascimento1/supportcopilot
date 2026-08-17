import { describe, it, expect } from "vitest"

import {
  pushNotification,
  dismissToast,
  dismissNotification,
  clearAllNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  MAX_HISTORY,
  DEFAULT_TOAST_DURATION_MS,
} from "./notifications-store"

// This module keeps its notification/toast arrays as module-private state —
// there is no exported getter for them (getNotifications/getToasts/subscribe
// are not exported). The only way to read that state is the useNotifications
// hook, which calls React's useSyncExternalStore and requires a real client
// render pass to see live state: a probe render via `react-dom/server`
// (renderToStaticMarkup) was tried and confirmed it only ever sees the
// hardcoded empty getServerSnapshot/getServerToasts, never the live store.
// Actually rendering the hook would need jsdom, @testing-library/react, or
// react-test-renderer, none of which are installed in this repo. So these
// tests exercise the mutator functions' public, directly observable
// contract — return values and no-throw/no-op safety — without reaching into
// the module's private array/Set internals. useNotifications itself (a thin
// useSyncExternalStore wrapper plus an unreadCount reduce) is left untested
// for the same reason.
//
// Ids are kept unique per test (via crypto.randomUUID()) because `seenIds`
// (the dedup set) is itself module-level state with no public reset, so
// reusing a literal id across tests could make an unrelated test's dedupe
// bleed into this one.
const uniqueId = () => `test-${crypto.randomUUID()}`

describe("pushNotification", () => {
  it("returns a generated id when no id is supplied", () => {
    const id = pushNotification({ title: "No id supplied" })
    expect(typeof id).toBe("string")
    expect(id.length).toBeGreaterThan(0)
  })

  it("generates a different id for each call without an explicit id", () => {
    const ids = new Set<string>()
    for (let i = 0; i < 50; i++) {
      ids.add(pushNotification({ title: `bulk-${i}` }))
    }
    expect(ids.size).toBe(50)
  })

  it("returns the exact id passed in input.id", () => {
    const id = uniqueId()
    expect(pushNotification({ title: "Explicit id", id })).toBe(id)
  })

  // Per the JSDoc: "a repeat push with a known id is a no-op and just
  // returns that id" — this is the dedup guard for polled server rows.
  it("returns the same id again on a duplicate push (dedup no-op)", () => {
    const id = uniqueId()
    const first = pushNotification({ title: "Original title", id })
    const second = pushNotification({ title: "A totally different title", id })
    expect(first).toBe(id)
    expect(second).toBe(id)
  })

  it("accepts only the required `title` field without throwing", () => {
    expect(() => pushNotification({ title: "Minimal" })).not.toThrow()
  })

  it("accepts every optional field without throwing", () => {
    expect(() =>
      pushNotification({
        title: "Full",
        message: "with a message",
        type: "warning",
        durationMs: 1000,
        id: uniqueId(),
        alertId: "alert-1",
        href: "/conversations/123",
        silent: true,
        createdAt: Date.now(),
      })
    ).not.toThrow()
  })
})

describe("dismissToast", () => {
  it("is a no-op (does not throw) for an id that was never pushed", () => {
    expect(() => dismissToast(uniqueId())).not.toThrow()
    expect(dismissToast(uniqueId())).toBeUndefined()
  })

  it("does not throw for an id that was pushed and already dismissed twice", () => {
    const id = pushNotification({ title: "Dismiss twice" })
    expect(() => {
      dismissToast(id)
      dismissToast(id)
    }).not.toThrow()
  })
})

describe("dismissNotification", () => {
  it("is a no-op (does not throw) for an id that was never pushed", () => {
    expect(() => dismissNotification(uniqueId())).not.toThrow()
    expect(dismissNotification(uniqueId())).toBeUndefined()
  })

  it("does not throw when dismissing the same id twice", () => {
    const id = pushNotification({ title: "Double dismiss" })
    expect(() => {
      dismissNotification(id)
      dismissNotification(id)
    }).not.toThrow()
  })
})

describe("markNotificationRead", () => {
  it("is a no-op (does not throw) for a nonexistent id", () => {
    expect(() => markNotificationRead(uniqueId())).not.toThrow()
    expect(markNotificationRead(uniqueId())).toBeUndefined()
  })

  it("does not throw when marking the same id read twice", () => {
    const id = pushNotification({ title: "Mark read twice" })
    expect(() => {
      markNotificationRead(id)
      markNotificationRead(id)
    }).not.toThrow()
  })
})

describe("markAllNotificationsRead", () => {
  it("does not throw regardless of current store contents", () => {
    pushNotification({ title: "Some notification" })
    expect(() => markAllNotificationsRead()).not.toThrow()
    // Calling again immediately hits the "every already read" early-return branch.
    expect(() => markAllNotificationsRead()).not.toThrow()
  })
})

describe("clearAllNotifications", () => {
  it("does not throw after pushing notifications", () => {
    pushNotification({ title: "To be cleared" })
    expect(() => clearAllNotifications()).not.toThrow()
  })

  it("does not throw when called back-to-back (hits the empty-store early return)", () => {
    clearAllNotifications()
    expect(() => clearAllNotifications()).not.toThrow()
  })
})

describe("module constants", () => {
  it("caps history at 50 entries", () => {
    expect(MAX_HISTORY).toBe(50)
  })

  it("defaults toast duration to 6000ms", () => {
    expect(DEFAULT_TOAST_DURATION_MS).toBe(6000)
  })
})
