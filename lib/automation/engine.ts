// Automation engine — pure boolean evaluator for the condition tree.
// No I/O, no server-only: fully unit-testable (see engine.test.ts).
// Implements Kayako-style DNF: OR across groups, AND within a group (configurable).

import type {
  Action,
  AutomationRule,
  Condition,
  ConditionGroup,
  ConditionTree,
  ConditionValue,
  EvalContext,
  FieldValue,
  Operator,
} from "./types"

/** Top-level: evaluate a rule's condition tree against a context. */
export function evaluateTree(tree: ConditionTree | null | undefined, ctx: EvalContext): boolean {
  // No tree / no groups → matches everything (Kayako "no conditions").
  if (!tree || !tree.groups || tree.groups.length === 0) return true
  const results = tree.groups.map((g) => evaluateGroup(g, ctx))
  return tree.match === "all" ? results.every(Boolean) : results.some(Boolean)
}

/** A group matches when all/any of its conditions match. Empty group → true. */
export function evaluateGroup(group: ConditionGroup, ctx: EvalContext): boolean {
  if (!group.conditions || group.conditions.length === 0) return true
  const results = group.conditions.map((c) => evaluateCondition(c, ctx))
  return group.match === "all" ? results.every(Boolean) : results.some(Boolean)
}

export function evaluateCondition(cond: Condition, ctx: EvalContext): boolean {
  // SLA conditions used to live in a special branch keyed off `cond.sla` plus the
  // `first_response_minutes` field, which was just the conversation's age — it
  // never knew about replies and kept matching after the SLA was already met.
  // The replacement uses Intercom's native sla_status + time_waiting_seconds
  // (see lib/automation/context.ts) and falls through this plain branch like
  // every other field.
  const actual = ctx.fields[cond.field]
  return applyOperator(cond.op, actual, cond.value)
}

/** One rule's actions to execute for a case, with `flow.stop` resolved. */
export type CaseActionPlanEntry = { rule: AutomationRule; actions: Action[] }

/**
 * Pure planner: given a case's applicable rules (already sorted by priority) and
 * its evaluation context, decide which actions run. A matching rule contributes
 * its actions up to (not including) the first `flow.stop`; once a matched rule
 * contains `flow.stop`, no further rules are processed for this case.
 * No I/O — the runner executes the returned plan.
 */
export function planCaseActions(
  rules: AutomationRule[],
  ctx: EvalContext
): CaseActionPlanEntry[] {
  const plan: CaseActionPlanEntry[] = []
  for (const rule of rules) {
    if (!evaluateTree(rule.conditions, ctx)) continue
    const actions: Action[] = []
    let stop = false
    for (const action of rule.actions) {
      if (action.kind === "flow.stop") {
        stop = true
        break
      }
      actions.push(action)
    }
    plan.push({ rule, actions })
    if (stop) break
  }
  return plan
}

// ── Operator application ─────────────────────────────────────────────────────

function toNumber(v: FieldValue | ConditionValue | undefined): number | null {
  if (typeof v === "number") return v
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v)
  return null
}

function toStringValue(v: FieldValue | ConditionValue | undefined): string {
  if (v === null || v === undefined) return ""
  if (Array.isArray(v)) return v.join(",")
  return String(v)
}

function toArray(v: FieldValue | ConditionValue | undefined): string[] {
  if (Array.isArray(v)) return v.map(String)
  if (v === null || v === undefined || v === "") return []
  return [String(v)]
}

/**
 * Apply a single operator. Unknown operators and invalid inputs return false
 * (fail-closed) so a malformed rule never accidentally matches everything.
 */
export function applyOperator(
  op: Operator,
  actual: FieldValue,
  expected?: ConditionValue
): boolean {
  switch (op) {
    case "is":
      return toStringValue(actual).toLowerCase() === toStringValue(expected).toLowerCase()
    case "is_not":
      return toStringValue(actual).toLowerCase() !== toStringValue(expected).toLowerCase()

    case "contains":
      return toStringValue(actual).toLowerCase().includes(toStringValue(expected).toLowerCase())
    case "not_contains":
      return !toStringValue(actual).toLowerCase().includes(toStringValue(expected).toLowerCase())

    case "matches_regex": {
      const pattern = toStringValue(expected)
      if (!pattern) return false
      try {
        // Case-insensitive by default (consistent with `is`/`contains`). Note: JS
        // RegExp does not support PCRE inline flags like `(?i)` — write a plain
        // pattern; matching is already case-insensitive.
        return new RegExp(pattern, "i").test(toStringValue(actual))
      } catch {
        return false // invalid regex never matches
      }
    }

    case "in": {
      // membership: actual (string or any element of actual array) is in expected list
      const haystack = toArray(expected).map((s) => s.toLowerCase())
      const needles = toArray(actual).map((s) => s.toLowerCase())
      if (needles.length === 0) return false
      return needles.some((n) => haystack.includes(n))
    }

    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = toNumber(actual)
      const b = toNumber(expected)
      if (a === null || b === null) return false
      switch (op) {
        case "eq":
          return a === b
        case "neq":
          return a !== b
        case "gt":
          return a > b
        case "gte":
          return a >= b
        case "lt":
          return a < b
        case "lte":
          return a <= b
      }
      return false
    }

    case "is_empty":
      return toArray(actual).length === 0
    case "not_empty":
      return toArray(actual).length > 0

    case "is_true":
      return actual === true || toStringValue(actual).toLowerCase() === "true"
    case "is_false":
      return actual === false || toStringValue(actual).toLowerCase() === "false"

    default:
      return false
  }
}
