// Automation engine — field & operator catalogue.
// SINGLE SOURCE OF TRUTH for both the UI condition builder and the evaluator,
// so the two can never drift. Pure module (no server-only).
//
// Field set is the subset of Kayako's conditions that maps onto what we know
// about an Intercom case today. Grows as the webhook (M5) surfaces more fields.

import type { Operator, RuleKind } from "./types"

export type FieldType = "text" | "enum" | "number" | "duration" | "tags" | "boolean" | "event"

export type FieldDef = {
  key: string
  label: string
  type: FieldType
  category: string
  /** enum option list, when type === "enum" | "event" */
  options?: { value: string; label: string; description?: string }[]
  /** which rule kinds this field is available in */
  appliesTo: RuleKind[]
  /** UI hint, e.g. durations are entered in minutes but stored/evaluated in seconds */
  unit?: "seconds" | "minutes"
}

/** Operators offered per field type — drives the operator dropdown in the builder. */
export const OPERATORS_BY_TYPE: Record<FieldType, Operator[]> = {
  text: ["is", "is_not", "contains", "not_contains", "matches_regex", "is_empty", "not_empty"],
  enum: ["is", "is_not", "in"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte"],
  duration: ["gt", "gte", "lt", "lte"],
  tags: ["contains", "not_contains", "in", "is_empty", "not_empty"],
  boolean: ["is_true", "is_false"],
  event: ["is"],
}

export const FIELDS: FieldDef[] = [
  // ── Conversation properties ──
  {
    key: "status",
    label: "Status",
    type: "enum",
    category: "Conversation",
    appliesTo: ["trigger", "monitor"],
    options: [
      { value: "open", label: "Open" },
      { value: "snoozed", label: "Snoozed" },
      { value: "closed", label: "Closed" },
    ],
  },
  {
    key: "priority_hint",
    label: "Priority hint (internal)",
    type: "enum",
    category: "Conversation",
    appliesTo: ["trigger", "monitor"],
    options: [
      { value: "urgent", label: "Urgent" },
      { value: "normal", label: "Normal" },
      { value: "low", label: "Low" },
    ],
  },
  {
    key: "priority",
    label: "Intercom priority",
    type: "enum",
    category: "Conversation",
    appliesTo: ["trigger", "monitor"],
    options: [
      { value: "priority", label: "Priority" },
      { value: "not_priority", label: "Not priority" },
    ],
  },
  {
    key: "subject",
    label: "Subject / snippet",
    type: "text",
    category: "Conversation",
    appliesTo: ["trigger", "monitor"],
  },
  {
    key: "tags",
    label: "Tags (Intercom)",
    type: "tags",
    category: "Conversation",
    appliesTo: ["trigger", "monitor"],
  },
  {
    key: "auto_tags",
    label: "Auto-tags (set by rules)",
    type: "tags",
    category: "Conversation",
    appliesTo: ["trigger", "monitor"],
  },
  {
    key: "is_creator",
    label: "Customer is a creator",
    type: "boolean",
    category: "Requester",
    appliesTo: ["trigger", "monitor"],
  },
  {
    key: "matched_playbook",
    label: "Matched playbook (case type)",
    type: "text",
    category: "Knowledge",
    appliesTo: ["trigger", "monitor"],
  },
  {
    key: "teammate",
    label: "Teammate (assigned to)",
    type: "text",
    category: "Conversation",
    appliesTo: ["trigger", "monitor"],
  },

  // ── Time-based (monitors lean on these) ──
  // NOTE: time_since_update is now Intercom's real `updated_at` (post live-Intercom
  // refactor). Pre-refactor it was derived from `opened_at` (cases had no updated_at
  // column). Use `time_since_created` for true age-since-open; use `time_since_update`
  // for "no activity since last reply/admin action".
  {
    key: "time_since_update",
    label: "Time since last update (Intercom)",
    type: "duration",
    category: "Time",
    appliesTo: ["monitor"],
    unit: "minutes",
  },
  {
    key: "time_since_created",
    label: "Time since created",
    type: "duration",
    category: "Time",
    appliesTo: ["monitor"],
    unit: "minutes",
  },

  // ── SLA (sourced from Intercom's native sla_applied + waiting_since fields) ──
  // The OLD `first_response_minutes` field with a per-condition `sla` threshold
  // was replaced because it just exposed the conversation's age — it kept firing
  // alerts after the admin had already replied. Intercom's sla_status flips to
  // "hit" / "missed" / "cancelled" once the clock resolves, so a rule that
  // matches on `sla_status is active` naturally stops firing.
  {
    key: "sla_status",
    label: "SLA status",
    type: "enum",
    category: "SLA",
    appliesTo: ["trigger", "monitor"],
    options: [
      { value: "active", label: "Active (clock running)" },
      { value: "hit", label: "Hit (replied in time)" },
      { value: "missed", label: "Missed (breached)" },
      { value: "cancelled", label: "Cancelled" },
      { value: "none", label: "No SLA applies" },
    ],
  },
  {
    key: "time_waiting_seconds",
    label: "Time waiting on SLA",
    type: "duration",
    category: "SLA",
    appliesTo: ["trigger", "monitor"],
    unit: "minutes",
  },

  // ── Event (triggers only) ──
  {
    key: "event",
    label: "Event type",
    type: "event",
    category: "Event",
    appliesTo: ["trigger"],
    // Topic strings must match what Intercom delivers in webhook payloads —
    // see https://developers.intercom.com/docs/references/webhooks/topics.
    // Anything else makes runTriggerForEvent skip the rule silently.
    options: [
      {
        value: "conversation.user.created",
        label: "New conversation from customer",
        description: "A customer started a new conversation.",
      },
      {
        value: "conversation.user.replied",
        label: "Customer replied",
        description: "A customer added a message to an existing conversation.",
      },
      {
        value: "conversation.admin.assigned",
        label: "Assigned to a teammate",
        description: "A conversation was assigned to a teammate (incl. Fin/AI).",
      },
      {
        value: "conversation.admin.replied",
        label: "Teammate replied",
        description: "A teammate sent a reply.",
      },
      {
        value: "conversation.admin.closed",
        label: "Conversation closed",
        description: "A teammate closed the conversation.",
      },
      {
        value: "conversation.rating.added",
        label: "CSAT rating received",
        description: "A customer submitted a CSAT rating.",
      },
    ],
  },
]

const FIELD_INDEX = new Map(FIELDS.map((f) => [f.key, f]))

export function getField(key: string): FieldDef | undefined {
  return FIELD_INDEX.get(key)
}

export function fieldsForKind(kind: RuleKind): FieldDef[] {
  return FIELDS.filter((f) => f.appliesTo.includes(kind))
}

export function operatorsForField(key: string): Operator[] {
  const f = getField(key)
  return f ? OPERATORS_BY_TYPE[f.type] : []
}
