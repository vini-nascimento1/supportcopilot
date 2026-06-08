import { describe, it, expect } from "vitest"

import { applyOperator, evaluateGroup, evaluateTree, planCaseActions } from "./engine"
import type { AutomationRule, ConditionTree, EvalContext } from "./types"

const ctx = (fields: EvalContext["fields"]): EvalContext => ({ fields })

describe("applyOperator", () => {
  it("text: is / is_not are case-insensitive", () => {
    expect(applyOperator("is", "Open", "open")).toBe(true)
    expect(applyOperator("is_not", "Open", "closed")).toBe(true)
    expect(applyOperator("is_not", "open", "open")).toBe(false)
  })

  it("text: contains / not_contains", () => {
    expect(applyOperator("contains", "chargeback dispute", "charge")).toBe(true)
    expect(applyOperator("not_contains", "payout failed", "login")).toBe(true)
  })

  it("matches_regex: case-insensitive by default, invalid regex fails closed", () => {
    expect(applyOperator("matches_regex", "Re: Chargeback received", "chargeback")).toBe(true)
    expect(applyOperator("matches_regex", "payout failed", "char(ge|d)back")).toBe(false)
    expect(applyOperator("matches_regex", "anything", "(")).toBe(false) // invalid regex
    expect(applyOperator("matches_regex", "anything", "")).toBe(false) // empty pattern
  })

  it("number & duration comparisons coerce strings", () => {
    expect(applyOperator("gt", 120, 60)).toBe(true)
    expect(applyOperator("lte", "60", 60)).toBe(true)
    expect(applyOperator("gt", undefined, 60)).toBe(false) // missing → false
    expect(applyOperator("eq", "abc", 1)).toBe(false) // non-numeric → false
  })

  it("tags: in / is_empty / not_empty", () => {
    expect(applyOperator("in", ["payout", "kyc"], ["payout"])).toBe(true)
    expect(applyOperator("in", ["login"], ["payout", "kyc"])).toBe(false)
    expect(applyOperator("is_empty", [])).toBe(true)
    expect(applyOperator("not_empty", ["x"])).toBe(true)
  })

  it("boolean: is_true / is_false accept real and string booleans", () => {
    expect(applyOperator("is_true", true)).toBe(true)
    expect(applyOperator("is_true", "true")).toBe(true)
    expect(applyOperator("is_false", false)).toBe(true)
    expect(applyOperator("is_true", false)).toBe(false)
  })

  it("unknown/garbage never matches", () => {
    // @ts-expect-error testing fail-closed on a bad operator
    expect(applyOperator("nonsense", "a", "a")).toBe(false)
  })
})

describe("evaluateGroup (AND / OR within a group)", () => {
  const c = ctx({ status: "open", tags: ["payout"], time_since_update: 90000 })

  it("match all = AND", () => {
    expect(
      evaluateGroup(
        {
          match: "all",
          conditions: [
            { field: "status", op: "is", value: "open" },
            { field: "tags", op: "in", value: ["payout"] },
          ],
        },
        c
      )
    ).toBe(true)
    expect(
      evaluateGroup(
        {
          match: "all",
          conditions: [
            { field: "status", op: "is", value: "open" },
            { field: "tags", op: "in", value: ["login"] },
          ],
        },
        c
      )
    ).toBe(false)
  })

  it("match any = OR", () => {
    expect(
      evaluateGroup(
        {
          match: "any",
          conditions: [
            { field: "status", op: "is", value: "closed" },
            { field: "tags", op: "in", value: ["payout"] },
          ],
        },
        c
      )
    ).toBe(true)
  })

  it("empty group matches everything", () => {
    expect(evaluateGroup({ match: "all", conditions: [] }, c)).toBe(true)
  })
})

describe("evaluateTree (DNF: OR across groups)", () => {
  const c = ctx({ status: "open", subject: "Re: chargeback received", time_since_update: 90000 })

  it("matches when ANY group matches (match: any)", () => {
    const tree: ConditionTree = {
      match: "any",
      groups: [
        {
          match: "all",
          conditions: [{ field: "status", op: "is", value: "closed" }], // fails
        },
        {
          match: "all",
          conditions: [{ field: "subject", op: "contains", value: "chargeback" }], // passes
        },
      ],
    }
    expect(evaluateTree(tree, c)).toBe(true)
  })

  it("match: all requires every group", () => {
    const tree: ConditionTree = {
      match: "all",
      groups: [
        { match: "all", conditions: [{ field: "status", op: "is", value: "open" }] },
        { match: "all", conditions: [{ field: "subject", op: "contains", value: "login" }] },
      ],
    }
    expect(evaluateTree(tree, c)).toBe(false)
  })

  it("empty tree / no groups matches everything", () => {
    expect(evaluateTree({ match: "any", groups: [] }, c)).toBe(true)
    expect(evaluateTree(null, c)).toBe(true)
  })

  it("realistic SLA-style monitor rule: open AND stale > 24h", () => {
    const tree: ConditionTree = {
      match: "any",
      groups: [
        {
          match: "all",
          conditions: [
            { field: "status", op: "is", value: "open" },
            { field: "time_since_update", op: "gt", value: 86400 }, // 24h in seconds
          ],
        },
      ],
    }
    expect(evaluateTree(tree, c)).toBe(true) // 90000s > 86400s
    expect(evaluateTree(tree, ctx({ status: "open", time_since_update: 100 }))).toBe(false)
  })

  it("sla_status + time_waiting_seconds: alerts only while clock is active", () => {
    // Rule: alert when SLA is active AND we've been waiting ≥ 15 min.
    const tree: ConditionTree = {
      match: "all",
      groups: [
        {
          match: "all",
          conditions: [
            { field: "sla_status", op: "is", value: "active" },
            { field: "time_waiting_seconds", op: "gte", value: 900 },
          ],
        },
      ],
    }

    // 16 min waiting, clock active → fires
    expect(evaluateTree(tree, ctx({ sla_status: "active", time_waiting_seconds: 960 }))).toBe(true)
    // 10 min waiting, clock active → too early
    expect(evaluateTree(tree, ctx({ sla_status: "active", time_waiting_seconds: 600 }))).toBe(false)
    // Admin already replied → clock hit → no alert even if old waiting time would have matched
    expect(evaluateTree(tree, ctx({ sla_status: "hit", time_waiting_seconds: null }))).toBe(false)
    // Already breached → caller might want a separate "missed" rule; this one ignores it
    expect(evaluateTree(tree, ctx({ sla_status: "missed", time_waiting_seconds: null }))).toBe(false)
    // No SLA configured → no alert
    expect(evaluateTree(tree, ctx({ sla_status: "none", time_waiting_seconds: null }))).toBe(false)
  })
})

describe("planCaseActions (flow.stop across rules)", () => {
  const rule = (id: string, priority: number, matchStatus: string, actions: AutomationRule["actions"]): AutomationRule => ({
    id,
    ownerId: "agent-1",
    name: id,
    kind: "monitor",
    enabled: true,
    priority,
    conditions: { match: "any", groups: [{ match: "all", conditions: [{ field: "status", op: "is", value: matchStatus }] }] },
    actions,
    sweepEveryMins: 5,
  })

  const c = ctx({ status: "open" })

  it("skips rules that don't match, keeps those that do", () => {
    const plan = planCaseActions(
      [
        rule("r1", 10, "closed", [{ kind: "alert.in_app" }]), // no match
        rule("r2", 20, "open", [{ kind: "case.flag" }]), // match
      ],
      c
    )
    expect(plan.map((p) => p.rule.id)).toEqual(["r2"])
  })

  it("flow.stop halts processing of lower-priority rules", () => {
    const plan = planCaseActions(
      [
        rule("r1", 10, "open", [{ kind: "alert.in_app" }, { kind: "flow.stop" }]),
        rule("r2", 20, "open", [{ kind: "case.flag" }]), // should be skipped
      ],
      c
    )
    expect(plan.map((p) => p.rule.id)).toEqual(["r1"])
    // actions before flow.stop are kept; flow.stop itself is not an executable action
    expect(plan[0].actions.map((a) => a.kind)).toEqual(["alert.in_app"])
  })
})
