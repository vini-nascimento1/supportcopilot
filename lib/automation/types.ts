// Automation engine — shared types.
// Pure module (no server-only): imported by both the engine and the UI builder.
// See "Feature - Automation (triggers & monitors)" and ADR-0007.

export type RuleKind = "trigger" | "monitor"

/** Operators the condition engine understands, grouped loosely by field type. */
export type Operator =
  // text
  | "is"
  | "is_not"
  | "contains"
  | "not_contains"
  | "matches_regex"
  // enum / array membership
  | "in"
  // number & duration (durations are seconds)
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  // tags / arrays
  | "is_empty"
  | "not_empty"
  // boolean
  | "is_true"
  | "is_false"

export type ConditionValue = string | number | boolean | string[]

export type Condition = {
  field: string
  op: Operator
  value?: ConditionValue
}

/** A group of conditions combined by `match` (all = AND, any = OR). */
export type ConditionGroup = {
  match: "all" | "any"
  conditions: Condition[]
}

/**
 * The full condition tree. Kayako-style DNF:
 *   match "any" → OR across groups (default), match "all" → AND across groups.
 * An empty tree (no groups) matches everything — same as Kayako's "no conditions".
 */
export type ConditionTree = {
  match: "all" | "any"
  groups: ConditionGroup[]
}

/**
 * The draft-only action set. NOTHING here can act toward a customer — that is the
 * safety boundary from ADR-0003 / ADR-0007, enforced by the absence of such kinds.
 */
export type ActionKind =
  | "alert.in_app"
  | "alert.slack" // owner DM only
  | "case.flag"
  | "case.suggest_playbook"
  | "draft.prestage"
  | "draft.macro" // fixed macro text staged as a draft (never sends)
  | "flow.stop"

export type Action = {
  kind: ActionKind
  params?: Record<string, unknown>
}

export type AutomationRule = {
  id: string
  ownerId: string
  name: string
  description?: string | null
  kind: RuleKind
  enabled: boolean
  priority: number
  conditions: ConditionTree
  actions: Action[]
  sweepEveryMins?: number | null
  onEvents?: string[] | null
}

/** A single evaluated field value. */
export type FieldValue = string | number | boolean | string[] | null | undefined

/** The normalised bag of fields the engine evaluates a rule against. */
export type EvalContext = {
  fields: Record<string, FieldValue>
}
