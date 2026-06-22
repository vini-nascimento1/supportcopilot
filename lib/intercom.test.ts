import { describe, expect, it } from "vitest"

import { classifyIntercomAuthor } from "./intercom"

describe("classifyIntercomAuthor", () => {
  it("treats customers as customer-authored", () => {
    expect(classifyIntercomAuthor({ type: "user" })).toBe("customer")
    expect(classifyIntercomAuthor({ type: "lead" })).toBe("customer")
    expect(classifyIntercomAuthor({ type: "contact" })).toBe("customer")
  })

  it("treats admins and teams as agent-authored", () => {
    expect(classifyIntercomAuthor({ type: "admin" })).toBe("admin")
    expect(classifyIntercomAuthor({ type: "team" })).toBe("admin")
  })

  it("treats Fin and Intercom bots as AI helper-authored", () => {
    expect(classifyIntercomAuthor({ type: "bot" })).toBe("ai")
    expect(classifyIntercomAuthor({ type: "admin", name: "Fin" })).toBe("ai")
    expect(
      classifyIntercomAuthor({ type: "admin", name: "Fin AI Agent" })
    ).toBe("ai")
  })
})
