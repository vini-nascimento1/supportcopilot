import { describe, it, expect, vi, beforeEach } from "vitest"

import type { ConditionTree } from "./types"

// getAgentContext talks to these two modules directly (not via an injected db),
// so they need mocking; every other function under test takes `db` as a plain
// parameter and is exercised against a hand-rolled fake query builder below.
vi.mock("@/lib/auth", () => ({ getSignedInEmail: vi.fn() }))
vi.mock("@/lib/supabase-admin", () => ({ getSupabaseAdminClient: vi.fn() }))

import { getSignedInEmail } from "@/lib/auth"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { createRule, deleteRule, getAgentContext, listRules, updateRule, type RuleInput } from "./rules"

type DbResult = { data?: unknown; error?: unknown }
type Recorder = { insert?: unknown; update?: unknown; eqCalls: [string, unknown][] }

/** Minimal fake Supabase query-builder chain covering the calls rules.ts makes. */
function fakeDb(opts: { thenResult?: DbResult; singleResult?: DbResult; maybeSingleResult?: DbResult } = {}) {
  const thenResult = opts.thenResult ?? { data: null, error: null }
  const singleResult = opts.singleResult ?? { data: null, error: null }
  const maybeSingleResult = opts.maybeSingleResult ?? { data: null, error: null }
  const recorder: Recorder = { eqCalls: [] }
  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      recorder.eqCalls.push([col, val])
      return chain
    },
    order: () => chain,
    insert: (row: unknown) => {
      recorder.insert = row
      return chain
    },
    update: (row: unknown) => {
      recorder.update = row
      return chain
    },
    delete: () => chain,
    maybeSingle: () => Promise.resolve(maybeSingleResult),
    single: () => Promise.resolve(singleResult),
    then: (resolve: (v: DbResult) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(thenResult).then(resolve, reject),
  }
  return { db: { from: () => chain } as unknown as NonNullable<ReturnType<typeof getSupabaseAdminClient>>, recorder }
}

const EMPTY: ConditionTree = { match: "any", groups: [] }

const baseInput = (overrides: Partial<RuleInput> = {}): RuleInput => ({
  name: "My rule",
  kind: "monitor",
  conditions: EMPTY,
  actions: [],
  ...overrides,
})

describe("createRule (input → row normalisation)", () => {
  it("monitor defaults: enabled false, priority 100, sweep 5min, on_events null", async () => {
    const { db, recorder } = fakeDb({ singleResult: { data: { id: "r1" }, error: null } })
    await createRule("agent-1", db, baseInput())
    const row = recorder.insert as Record<string, unknown>
    expect(row.enabled).toBe(false)
    expect(row.priority).toBe(100)
    expect(row.sweep_every_mins).toBe(5)
    expect(row.on_events).toBeNull()
  })

  it("trigger without onEvents falls back to the default topic list; sweep is null", async () => {
    const { db, recorder } = fakeDb({ singleResult: { data: { id: "r2" }, error: null } })
    await createRule("agent-1", db, baseInput({ kind: "trigger" }))
    const row = recorder.insert as Record<string, unknown>
    expect(row.sweep_every_mins).toBeNull()
    expect(row.on_events).toEqual(["conversation.user.created", "conversation.admin.assigned"])
  })

  it("trigger with explicit onEvents keeps them as given", async () => {
    const { db, recorder } = fakeDb({ singleResult: { data: { id: "r3" }, error: null } })
    await createRule("agent-1", db, baseInput({ kind: "trigger", onEvents: ["conversation.rating.added"] }))
    expect((recorder.insert as Record<string, unknown>).on_events).toEqual(["conversation.rating.added"])
  })

  it("blank/whitespace-only name falls back to 'Untitled rule'; real names are trimmed", async () => {
    const { db, recorder } = fakeDb({ singleResult: { data: { id: "r4" }, error: null } })
    await createRule("agent-1", db, baseInput({ name: "   " }))
    expect((recorder.insert as Record<string, unknown>).name).toBe("Untitled rule")

    const { db: db2, recorder: recorder2 } = fakeDb({ singleResult: { data: { id: "r5" }, error: null } })
    await createRule("agent-1", db2, baseInput({ name: "  Payout SLA  " }))
    expect((recorder2.insert as Record<string, unknown>).name).toBe("Payout SLA")
  })

  it("explicit priority and sweepEveryMins override the defaults", async () => {
    const { db, recorder } = fakeDb({ singleResult: { data: { id: "r6" }, error: null } })
    await createRule("agent-1", db, baseInput({ priority: 5, sweepEveryMins: 15 }))
    const row = recorder.insert as Record<string, unknown>
    expect(row.priority).toBe(5)
    expect(row.sweep_every_mins).toBe(15)
  })

  it("maps the returned row back through rowToRule, defaulting nullable DB columns", async () => {
    const { db } = fakeDb({
      singleResult: {
        data: {
          id: "r7",
          owner_id: "agent-1",
          name: "X",
          kind: "monitor",
          enabled: true,
          priority: 10,
          conditions: null,
          actions: null,
          sweep_every_mins: null,
          on_events: null,
        },
        error: null,
      },
    })
    const rule = await createRule("agent-1", db, baseInput())
    expect(rule.conditions).toEqual(EMPTY) // null → EMPTY_TREE
    expect(rule.actions).toEqual([]) // null → []
    expect(rule.sweepEveryMins).toBeNull()
    expect(rule.onEvents).toBeNull()
  })

  it("propagates a DB error as a thrown Error", async () => {
    const { db } = fakeDb({ singleResult: { data: null, error: { message: "insert failed" } } })
    await expect(createRule("agent-1", db, baseInput())).rejects.toThrow("insert failed")
  })
})

describe("updateRule (patch → row normalisation)", () => {
  it("throws 'Rule not found' when the current row doesn't exist (or isn't owned by this agent)", async () => {
    const { db } = fakeDb({ maybeSingleResult: { data: null } })
    await expect(updateRule("agent-1", db, "missing-id", { name: "x" })).rejects.toThrow("Rule not found")
  })

  it("switching monitor → trigger without onEvents nulls the sweep and applies default topics", async () => {
    const { db, recorder } = fakeDb({
      maybeSingleResult: { data: { kind: "monitor", sweep_every_mins: 5, on_events: null } },
      singleResult: { data: { id: "r1" }, error: null },
    })
    await updateRule("agent-1", db, "r1", { kind: "trigger" })
    const row = recorder.update as Record<string, unknown>
    expect(row.sweep_every_mins).toBeNull()
    expect(row.on_events).toEqual(["conversation.user.created", "conversation.admin.assigned"])
  })

  it("switching trigger → monitor with an explicit sweepEveryMins uses it (not the 5min default)", async () => {
    const { db, recorder } = fakeDb({
      maybeSingleResult: { data: { kind: "trigger", sweep_every_mins: null, on_events: ["conversation.user.created"] } },
      singleResult: { data: { id: "r2" }, error: null },
    })
    await updateRule("agent-1", db, "r2", { kind: "monitor", sweepEveryMins: 30 })
    const row = recorder.update as Record<string, unknown>
    expect(row.sweep_every_mins).toBe(30)
    expect(row.on_events).toBeNull()
  })

  it("patch that touches neither kind nor sweep/on_events leaves those columns untouched", async () => {
    const { db, recorder } = fakeDb({
      maybeSingleResult: { data: { kind: "monitor", sweep_every_mins: 5, on_events: null } },
      singleResult: { data: { id: "r3" }, error: null },
    })
    await updateRule("agent-1", db, "r3", { enabled: true })
    const row = recorder.update as Record<string, unknown>
    expect(row.enabled).toBe(true)
    expect("sweep_every_mins" in row).toBe(false)
    expect("on_events" in row).toBe(false)
  })

  it("blank name patch falls back to 'Untitled rule'", async () => {
    const { db, recorder } = fakeDb({
      maybeSingleResult: { data: { kind: "monitor", sweep_every_mins: 5, on_events: null } },
      singleResult: { data: { id: "r4" }, error: null },
    })
    await updateRule("agent-1", db, "r4", { name: "   " })
    expect((recorder.update as Record<string, unknown>).name).toBe("Untitled rule")
  })

  it("propagates a DB error as a thrown Error", async () => {
    const { db } = fakeDb({
      maybeSingleResult: { data: { kind: "monitor", sweep_every_mins: 5, on_events: null } },
      singleResult: { data: null, error: { message: "update failed" } },
    })
    await expect(updateRule("agent-1", db, "r5", { enabled: true })).rejects.toThrow("update failed")
  })
})

describe("listRules", () => {
  it("maps rows through rowToRule and defaults nullable columns", async () => {
    const { db } = fakeDb({
      thenResult: {
        data: [
          {
            id: "r1",
            owner_id: "agent-1",
            name: "Rule 1",
            kind: "monitor",
            enabled: true,
            priority: 10,
            conditions: null,
            actions: null,
            sweep_every_mins: null,
            on_events: null,
          },
        ],
        error: null,
      },
    })
    const rules = await listRules("agent-1", db)
    expect(rules).toHaveLength(1)
    expect(rules[0].conditions).toEqual(EMPTY)
    expect(rules[0].actions).toEqual([])
  })

  it("empty rule set returns an empty array, not null/undefined", async () => {
    const { db } = fakeDb({ thenResult: { data: null, error: null } })
    expect(await listRules("agent-1", db)).toEqual([])
  })

  it("propagates a DB error", async () => {
    const { db } = fakeDb({ thenResult: { data: null, error: { message: "boom" } } })
    await expect(listRules("agent-1", db)).rejects.toThrow("boom")
  })
})

describe("deleteRule", () => {
  it("resolves without throwing on success", async () => {
    const { db } = fakeDb({ thenResult: { error: null } })
    await expect(deleteRule("agent-1", db, "r1")).resolves.toBeUndefined()
  })

  it("propagates a DB error", async () => {
    const { db } = fakeDb({ thenResult: { error: { message: "delete failed" } } })
    await expect(deleteRule("agent-1", db, "r1")).rejects.toThrow("delete failed")
  })
})

describe("getAgentContext", () => {
  beforeEach(() => {
    vi.mocked(getSignedInEmail).mockReset()
    vi.mocked(getSupabaseAdminClient).mockReset()
  })

  it("not signed in → no db lookup at all", async () => {
    vi.mocked(getSignedInEmail).mockResolvedValue(null)
    const ctx = await getAgentContext()
    expect(ctx).toEqual({ db: null, agentId: null, email: null })
    expect(getSupabaseAdminClient).not.toHaveBeenCalled()
  })

  it("signed in but no admin client configured → agentId null, email kept", async () => {
    vi.mocked(getSignedInEmail).mockResolvedValue("agent@fanvue.com")
    vi.mocked(getSupabaseAdminClient).mockReturnValue(null)
    const ctx = await getAgentContext()
    expect(ctx).toEqual({ db: null, agentId: null, email: "agent@fanvue.com" })
  })

  it("signed in, agent row found → resolves agentId", async () => {
    vi.mocked(getSignedInEmail).mockResolvedValue("agent@fanvue.com")
    const { db } = fakeDb({ maybeSingleResult: { data: { id: "agent-123" } } })
    vi.mocked(getSupabaseAdminClient).mockReturnValue(db)
    const ctx = await getAgentContext()
    expect(ctx.agentId).toBe("agent-123")
    expect(ctx.email).toBe("agent@fanvue.com")
  })

  it("signed in, no matching agent row → agentId null (not an agent)", async () => {
    vi.mocked(getSignedInEmail).mockResolvedValue("stranger@fanvue.com")
    const { db } = fakeDb({ maybeSingleResult: { data: null } })
    vi.mocked(getSupabaseAdminClient).mockReturnValue(db)
    const ctx = await getAgentContext()
    expect(ctx.agentId).toBeNull()
  })
})
