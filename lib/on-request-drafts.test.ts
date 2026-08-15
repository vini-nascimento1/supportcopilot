import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

import {
  addPendingOnRequestDrafts,
  isStuck,
  readPendingOnRequestDrafts,
  removePendingOnRequestDrafts,
  subscribePendingOnRequestDrafts,
  STUCK_AFTER_MS,
} from "./on-request-drafts"

const KEY = "fv-on-request-drafts"

// vitest's default node environment has no real localStorage/window; stand in
// with an in-memory store and a plain EventTarget so write()'s
// dispatchEvent/addEventListener calls have something to talk to.
function makeLocalStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, v)
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => store.clear(),
  }
}

beforeEach(() => {
  vi.stubGlobal("localStorage", makeLocalStorage())
  vi.stubGlobal("window", new EventTarget())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("addPendingOnRequestDrafts / readPendingOnRequestDrafts", () => {
  it("returns [] when nothing has been added", () => {
    expect(readPendingOnRequestDrafts()).toEqual([])
  })

  it("adds an entry retrievable via readPendingOnRequestDrafts", () => {
    addPendingOnRequestDrafts([{ conversationId: "c1", customerName: "Ada", subject: "Hi" }])
    const items = readPendingOnRequestDrafts()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ conversationId: "c1", customerName: "Ada", subject: "Hi" })
  })

  it("overwrites an existing pending entry for the same conversation id", () => {
    addPendingOnRequestDrafts([{ conversationId: "c1", customerName: "Ada", subject: "Hi" }])
    addPendingOnRequestDrafts([{ conversationId: "c1", customerName: "Ada", subject: "Updated" }])
    const items = readPendingOnRequestDrafts()
    expect(items).toHaveLength(1)
    expect(items[0].subject).toBe("Updated")
  })

  it("returns [] on corrupt JSON instead of throwing", () => {
    localStorage.setItem(KEY, "{not json")
    expect(readPendingOnRequestDrafts()).toEqual([])
  })
})

describe("removePendingOnRequestDrafts", () => {
  it("removes only the targeted id", () => {
    addPendingOnRequestDrafts([
      { conversationId: "c1", customerName: "Ada", subject: null },
      { conversationId: "c2", customerName: "Bea", subject: null },
    ])
    removePendingOnRequestDrafts(["c1"])
    const ids = readPendingOnRequestDrafts().map((i) => i.conversationId)
    expect(ids).toEqual(["c2"])
  })

  it("is a no-op (no write, no event) when called with an empty id list", () => {
    addPendingOnRequestDrafts([{ conversationId: "c1", customerName: "Ada", subject: null }])
    const cb = vi.fn()
    const unsubscribe = subscribePendingOnRequestDrafts(cb)
    removePendingOnRequestDrafts([])
    expect(cb).not.toHaveBeenCalled()
    unsubscribe()
  })

  it("does not write or dispatch when none of the given ids match a pending draft", () => {
    // This is the shape the Queue panel's 15s poll actually calls it with —
    // the full list of ids already resolved into real rows, almost never
    // overlapping what's still pending. It must not hand a fresh array
    // identity to every mounted QueuePanel on every tick.
    addPendingOnRequestDrafts([{ conversationId: "c1", customerName: "Ada", subject: null }])
    const cb = vi.fn()
    const unsubscribe = subscribePendingOnRequestDrafts(cb)
    removePendingOnRequestDrafts(["c-unrelated-1", "c-unrelated-2"])
    expect(cb).not.toHaveBeenCalled()
    expect(readPendingOnRequestDrafts()).toHaveLength(1)
    unsubscribe()
  })

  it("does write and dispatch when at least one given id matches", () => {
    addPendingOnRequestDrafts([
      { conversationId: "c1", customerName: "Ada", subject: null },
      { conversationId: "c2", customerName: "Bea", subject: null },
    ])
    const cb = vi.fn()
    const unsubscribe = subscribePendingOnRequestDrafts(cb)
    removePendingOnRequestDrafts(["c-unrelated", "c1"])
    expect(cb).toHaveBeenCalledTimes(1)
    expect(readPendingOnRequestDrafts().map((i) => i.conversationId)).toEqual(["c2"])
    unsubscribe()
  })
})

describe("isStuck", () => {
  it("is false for a draft requested just now", () => {
    const item = { conversationId: "c1", customerName: null, subject: null, requestedAt: new Date().toISOString() }
    expect(isStuck(item)).toBe(false)
  })

  it("is true once STUCK_AFTER_MS has elapsed", () => {
    const requestedAt = new Date(Date.now() - STUCK_AFTER_MS - 1).toISOString()
    const item = { conversationId: "c1", customerName: null, subject: null, requestedAt }
    expect(isStuck(item)).toBe(true)
  })

  it("is false for a malformed requestedAt", () => {
    const item = { conversationId: "c1", customerName: null, subject: null, requestedAt: "not-a-date" }
    expect(isStuck(item)).toBe(false)
  })
})

describe("subscribePendingOnRequestDrafts", () => {
  it("also reacts to a native 'storage' event (cross-tab sync)", () => {
    const cb = vi.fn()
    const unsubscribe = subscribePendingOnRequestDrafts(cb)
    window.dispatchEvent(new Event("storage"))
    expect(cb).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it("stops firing after unsubscribe", () => {
    const cb = vi.fn()
    const unsubscribe = subscribePendingOnRequestDrafts(cb)
    unsubscribe()
    addPendingOnRequestDrafts([{ conversationId: "c1", customerName: null, subject: null }])
    expect(cb).not.toHaveBeenCalled()
  })
})
