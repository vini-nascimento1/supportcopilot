import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// actions.ts reaches these directly (getSupabaseAdminClient() with no injection,
// module-level imports for Slack + prestage), so they need mocking to unit-test
// the branching logic (template resolution, patch building, Slack fallback tiers).
vi.mock("@/lib/supabase-admin", () => ({ getSupabaseAdminClient: vi.fn() }))
vi.mock("@/lib/slack", () => ({ sendSlackMessage: vi.fn() }))
vi.mock("./prestage", () => ({ prestageDraft: vi.fn(), stageMacroDraft: vi.fn() }))

import { getSupabaseAdminClient } from "@/lib/supabase-admin"
import { sendSlackMessage } from "@/lib/slack"
import { prestageDraft, stageMacroDraft } from "./prestage"
import { runAction, type ActionTarget } from "./actions"

type DbResult = { data?: unknown; error?: unknown }
type Recorder = { upsert?: unknown; update?: unknown }

/** Minimal fake Supabase chain covering actions.ts's select/upsert/update calls. */
function fakeDb(opts: { thenResult?: DbResult; maybeSingleResult?: DbResult } = {}) {
  const thenResult = opts.thenResult ?? { error: null }
  const maybeSingleResult = opts.maybeSingleResult ?? { data: null }
  const recorder: Recorder = {}
  const chain = {
    select: () => chain,
    eq: () => chain,
    upsert: (row: unknown) => {
      recorder.upsert = row
      return chain
    },
    update: (row: unknown) => {
      recorder.update = row
      return chain
    },
    maybeSingle: () => Promise.resolve(maybeSingleResult),
    then: (resolve: (v: DbResult) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(thenResult).then(resolve, reject),
  }
  return { db: { from: () => chain } as unknown as NonNullable<ReturnType<typeof getSupabaseAdminClient>>, recorder }
}

const target = (overrides: Partial<ActionTarget> = {}): ActionTarget => ({
  ruleId: "rule-1",
  ownerId: "agent-1",
  caseId: "case-1",
  intercomConversationId: "conv-1",
  nowMs: new Date("2026-08-12T12:00:00.000Z").getTime(),
  ...overrides,
})

beforeEach(() => {
  vi.mocked(getSupabaseAdminClient).mockReset()
  vi.mocked(sendSlackMessage).mockReset()
  vi.mocked(prestageDraft).mockReset()
  vi.mocked(stageMacroDraft).mockReset()
})

describe("runAction dispatch", () => {
  it("unknown action kind fails closed without touching any handler", async () => {
    // @ts-expect-error testing an action kind that doesn't exist
    const res = await runAction({ kind: "bogus.kind" }, target())
    expect(res).toEqual({ kind: "bogus.kind", applied: false, detail: "unknown action kind" })
  })

  it("flow.stop is a safe no-op when it reaches the handler map directly", async () => {
    const res = await runAction({ kind: "flow.stop" }, target())
    expect(res).toEqual({ kind: "flow.stop", applied: true, detail: "handled by planner" })
  })
})

describe("alert.in_app", () => {
  it("no admin client configured → not applied", async () => {
    vi.mocked(getSupabaseAdminClient).mockReturnValue(null)
    const res = await runAction({ kind: "alert.in_app" }, target())
    expect(res).toEqual({ kind: "alert.in_app", applied: false, detail: "no admin client" })
  })

  it("uses the default body when no text param is given", async () => {
    const { db, recorder } = fakeDb()
    vi.mocked(getSupabaseAdminClient).mockReturnValue(db)
    await runAction({ kind: "alert.in_app" }, target())
    expect((recorder.upsert as { body: string }).body).toBe("Automation matched this case.")
  })

  it("resolves known {{placeholders}} and leaves unknown ones untouched", async () => {
    const { db, recorder } = fakeDb()
    vi.mocked(getSupabaseAdminClient).mockReturnValue(db)
    await runAction(
      { kind: "alert.in_app", params: { text: "{{customer}} on {{rule_name}} — {{mystery}}" } },
      target({ customer: "Jane", ruleName: "SLA Monitor" })
    )
    expect((recorder.upsert as { body: string }).body).toBe("Jane on SLA Monitor — {{mystery}}")
  })

  it("surfaces a DB error as not-applied", async () => {
    const { db } = fakeDb({ thenResult: { error: { message: "upsert failed" } } })
    vi.mocked(getSupabaseAdminClient).mockReturnValue(db)
    const res = await runAction({ kind: "alert.in_app" }, target())
    expect(res).toEqual({ kind: "alert.in_app", applied: false, detail: "upsert failed" })
  })
})

describe("case.flag", () => {
  it("no case id → not applied", async () => {
    vi.mocked(getSupabaseAdminClient).mockReturnValue(fakeDb().db)
    const res = await runAction({ kind: "case.flag", params: { priority_hint: "urgent" } }, target({ caseId: null }))
    expect(res).toEqual({ kind: "case.flag", applied: false, detail: "no case id" })
  })

  it("no usable params → not applied, no DB write", async () => {
    vi.mocked(getSupabaseAdminClient).mockReturnValue(fakeDb().db)
    const res = await runAction({ kind: "case.flag", params: {} }, target())
    expect(res).toEqual({ kind: "case.flag", applied: false, detail: "no flag params" })
  })

  it("invalid priority_hint value is ignored (fails closed, not written)", async () => {
    const { db, recorder } = fakeDb()
    vi.mocked(getSupabaseAdminClient).mockReturnValue(db)
    const res = await runAction({ kind: "case.flag", params: { priority_hint: "on_fire" } }, target())
    expect(res.applied).toBe(false)
    expect(recorder.update).toBeUndefined()
  })

  it("valid priority_hint is written", async () => {
    const { db, recorder } = fakeDb()
    vi.mocked(getSupabaseAdminClient).mockReturnValue(db)
    await runAction({ kind: "case.flag", params: { priority_hint: "urgent" } }, target())
    expect((recorder.update as Record<string, unknown>).priority_hint).toBe("urgent")
  })

  it("add_tags merges with existing auto_tags and de-dupes", async () => {
    const { db, recorder } = fakeDb({ maybeSingleResult: { data: { auto_tags: ["existing", "payout"] } } })
    vi.mocked(getSupabaseAdminClient).mockReturnValue(db)
    await runAction({ kind: "case.flag", params: { add_tags: ["payout", "new_tag"] } }, target())
    expect((recorder.update as Record<string, string[]>).auto_tags.sort()).toEqual(
      ["existing", "new_tag", "payout"].sort()
    )
  })

  it("needs_attention_in_mins computes an absolute ISO timestamp from the injected clock", async () => {
    const { db, recorder } = fakeDb()
    vi.mocked(getSupabaseAdminClient).mockReturnValue(db)
    const nowMs = new Date("2026-08-12T12:00:00.000Z").getTime()
    await runAction({ kind: "case.flag", params: { needs_attention_in_mins: 30 } }, target({ nowMs }))
    expect((recorder.update as Record<string, unknown>).needs_attention_at).toBe("2026-08-12T12:30:00.000Z")
  })

  it("surfaces a DB error as not-applied", async () => {
    const { db } = fakeDb({ thenResult: { error: { message: "update failed" } } })
    vi.mocked(getSupabaseAdminClient).mockReturnValue(db)
    const res = await runAction({ kind: "case.flag", params: { priority_hint: "low" } }, target())
    expect(res).toEqual({ kind: "case.flag", applied: false, detail: "update failed" })
  })
})

describe("case.suggest_playbook", () => {
  it("no case id → not applied", async () => {
    vi.mocked(getSupabaseAdminClient).mockReturnValue(fakeDb().db)
    const res = await runAction(
      { kind: "case.suggest_playbook", params: { playbook_id: "pb-1" } },
      target({ caseId: null })
    )
    expect(res).toEqual({ kind: "case.suggest_playbook", applied: false, detail: "no case id" })
  })

  it("missing playbook_id → not applied", async () => {
    vi.mocked(getSupabaseAdminClient).mockReturnValue(fakeDb().db)
    const res = await runAction({ kind: "case.suggest_playbook", params: {} }, target())
    expect(res).toEqual({ kind: "case.suggest_playbook", applied: false, detail: "no playbook_id" })
  })

  it("writes the playbook id on success", async () => {
    const { db, recorder } = fakeDb()
    vi.mocked(getSupabaseAdminClient).mockReturnValue(db)
    const res = await runAction({ kind: "case.suggest_playbook", params: { playbook_id: "pb-1" } }, target())
    expect((recorder.update as Record<string, unknown>).playbook_id).toBe("pb-1")
    expect(res.applied).toBe(true)
  })
})

describe("alert.slack (owner-DM-only fallback chain)", () => {
  const realFetch = global.fetch

  afterEach(() => {
    global.fetch = realFetch
    delete process.env.SLACK_BOT_TOKEN
  })

  it("no admin client → not applied", async () => {
    vi.mocked(getSupabaseAdminClient).mockReturnValue(null)
    const res = await runAction({ kind: "alert.slack" }, target())
    expect(res).toEqual({ kind: "alert.slack", applied: false, detail: "no admin client" })
  })

  it("resolves via the owner's own token (self-DM) when no bot token is configured", async () => {
    const { db } = fakeDb({ maybeSingleResult: { data: { email: "a@fanvue.com", slack_token: "xoxp-owner" } } })
    vi.mocked(getSupabaseAdminClient).mockReturnValue(db)
    global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ ok: true, user_id: "U123" }) }) as unknown as typeof fetch
    vi.mocked(sendSlackMessage).mockResolvedValue({ ok: true, ts: "1" })

    const res = await runAction({ kind: "alert.slack", params: { text: "hi" } }, target())
    expect(res).toEqual({ kind: "alert.slack", applied: true, detail: "slack self-DM sent (no bot token)" })
    expect(sendSlackMessage).toHaveBeenCalledWith("xoxp-owner", "U123", expect.stringContaining("hi"))
  })

  it("prefers the bot token (real DM) when the owner's own token can't authenticate", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-bot"
    const { db } = fakeDb({ maybeSingleResult: { data: { email: "a@fanvue.com", slack_token: "xoxp-bad" } } })
    vi.mocked(getSupabaseAdminClient).mockReturnValue(db)
    global.fetch = vi.fn(async (url: string | URL) => {
      const u = String(url)
      if (u.includes("auth.test")) return { json: async () => ({ ok: false }) } as Response
      if (u.includes("users.lookupByEmail")) return { json: async () => ({ ok: true, user: { id: "U456" } }) } as Response
      throw new Error(`unexpected fetch: ${u}`)
    }) as unknown as typeof fetch
    vi.mocked(sendSlackMessage).mockResolvedValue({ ok: true, ts: "1" })

    const res = await runAction({ kind: "alert.slack", params: { text: "hi" } }, target())
    expect(res).toEqual({ kind: "alert.slack", applied: true, detail: "slack bot DM sent" })
    expect(sendSlackMessage).toHaveBeenCalledWith("xoxb-bot", "U456", expect.any(String))
  })

  it("degrades to an in-app alert when no user id can be resolved at all (nothing lost)", async () => {
    const { db } = fakeDb({ maybeSingleResult: { data: { email: null, slack_token: null } } })
    vi.mocked(getSupabaseAdminClient).mockReturnValue(db)

    const res = await runAction({ kind: "alert.slack", params: { text: "hi" } }, target())
    expect(res.kind).toBe("alert.in_app") // degraded, not the original alert.slack kind
    expect(res.applied).toBe(true)
    expect(sendSlackMessage).not.toHaveBeenCalled()
  })

  it("a failed Slack send is reported as not applied", async () => {
    const { db } = fakeDb({ maybeSingleResult: { data: { email: "a@fanvue.com", slack_token: "xoxp-owner" } } })
    vi.mocked(getSupabaseAdminClient).mockReturnValue(db)
    global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ ok: true, user_id: "U123" }) }) as unknown as typeof fetch
    vi.mocked(sendSlackMessage).mockResolvedValue({ ok: false, error: "channel_not_found" })

    const res = await runAction({ kind: "alert.slack", params: { text: "hi" } }, target())
    expect(res).toEqual({ kind: "alert.slack", applied: false, detail: "channel_not_found" })
  })
})

describe("draft.prestage / draft.macro (thin delegation, verified once each)", () => {
  it("draft.prestage delegates to prestageDraft with the conversation id", async () => {
    vi.mocked(prestageDraft).mockResolvedValue({ applied: true, detail: "staged" })
    const res = await runAction({ kind: "draft.prestage" }, target({ intercomConversationId: "conv-42" }))
    expect(prestageDraft).toHaveBeenCalledWith("conv-42")
    expect(res).toEqual({ kind: "draft.prestage", applied: true, detail: "staged" })
  })

  it("draft.macro passes whitespace-only text through as null (asString fails closed)", async () => {
    vi.mocked(stageMacroDraft).mockResolvedValue({ applied: false, detail: "no macro text" })
    await runAction({ kind: "draft.macro", params: { text: "   " } }, target({ intercomConversationId: "conv-1" }))
    expect(stageMacroDraft).toHaveBeenCalledWith("conv-1", null)
  })
})
