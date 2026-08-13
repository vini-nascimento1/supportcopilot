import { describe, it, expect } from "vitest"

import { FIELDS, OPERATORS_BY_TYPE, getField, fieldsForKind, operatorsForField } from "./fields"

describe("getField", () => {
  it("returns the field def for a known key", () => {
    const f = getField("status")
    expect(f?.type).toBe("enum")
    expect(f?.category).toBe("Conversation")
  })

  it("returns undefined for an unknown key", () => {
    expect(getField("does_not_exist")).toBeUndefined()
  })
})

describe("fieldsForKind", () => {
  it("monitor includes time-based fields but excludes the trigger-only event field", () => {
    const keys = fieldsForKind("monitor").map((f) => f.key)
    expect(keys).toContain("time_since_update")
    expect(keys).not.toContain("event")
  })

  it("trigger includes the event field but excludes monitor-only time fields", () => {
    const keys = fieldsForKind("trigger").map((f) => f.key)
    expect(keys).toContain("event")
    expect(keys).not.toContain("time_since_update")
  })

  it("both kinds share fields that apply to both (e.g. status, sla_status)", () => {
    const monitorKeys = fieldsForKind("monitor").map((f) => f.key)
    const triggerKeys = fieldsForKind("trigger").map((f) => f.key)
    expect(monitorKeys).toContain("status")
    expect(triggerKeys).toContain("status")
  })
})

describe("operatorsForField", () => {
  it("returns the operator set for the field's type", () => {
    expect(operatorsForField("status")).toEqual(OPERATORS_BY_TYPE.enum)
    expect(operatorsForField("time_since_update")).toEqual(OPERATORS_BY_TYPE.duration)
    expect(operatorsForField("tags")).toEqual(OPERATORS_BY_TYPE.tags)
  })

  it("unknown field key fails closed to an empty operator list", () => {
    expect(operatorsForField("nonsense")).toEqual([])
  })
})

describe("FIELDS / OPERATORS_BY_TYPE data integrity", () => {
  it("has no duplicate field keys (duplicates would silently overwrite in getField's index)", () => {
    const keys = FIELDS.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("every field's type has a defined operator list", () => {
    for (const f of FIELDS) {
      expect(OPERATORS_BY_TYPE[f.type]).toBeDefined()
    }
  })

  it("enum/event fields declare options", () => {
    for (const f of FIELDS) {
      if (f.type === "enum" || f.type === "event") {
        expect(f.options?.length ?? 0).toBeGreaterThan(0)
      }
    }
  })
})
