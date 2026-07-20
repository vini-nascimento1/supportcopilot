import { describe, it, expect, beforeEach, afterEach } from "vitest"

import { encryptSecret, decryptSecret, providerCryptoAvailable } from "./provider-crypto"

// A fixed 32-byte hex key for deterministic tests.
const KEY_HEX = "0".repeat(64)

describe("provider-crypto", () => {
  const original = process.env.PROVIDER_ENCRYPTION_KEY

  beforeEach(() => {
    process.env.PROVIDER_ENCRYPTION_KEY = KEY_HEX
  })
  afterEach(() => {
    process.env.PROVIDER_ENCRYPTION_KEY = original
  })

  it("round-trips a secret", () => {
    const enc = encryptSecret("sk-test-abc123")
    expect(enc).not.toContain("sk-test-abc123") // not stored in plaintext
    expect(decryptSecret(enc)).toBe("sk-test-abc123")
  })

  it("produces a different ciphertext each time (random IV)", () => {
    const a = encryptSecret("same-value")
    const b = encryptSecret("same-value")
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe("same-value")
    expect(decryptSecret(b)).toBe("same-value")
  })

  it("accepts a base64 master key", () => {
    process.env.PROVIDER_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64")
    const enc = encryptSecret("hello")
    expect(decryptSecret(enc)).toBe("hello")
  })

  it("returns null decrypting under a different master key", () => {
    const enc = encryptSecret("secret")
    process.env.PROVIDER_ENCRYPTION_KEY = "f".repeat(64)
    expect(decryptSecret(enc)).toBeNull()
  })

  it("returns null on tampered ciphertext", () => {
    const enc = encryptSecret("secret")
    const tampered = enc.slice(0, -4) + (enc.endsWith("A") ? "B" : "A") + "==="
    expect(decryptSecret(tampered)).toBeNull()
  })

  it("reports availability from the env key", () => {
    expect(providerCryptoAvailable()).toBe(true)
    delete process.env.PROVIDER_ENCRYPTION_KEY
    expect(providerCryptoAvailable()).toBe(false)
    expect(() => encryptSecret("x")).toThrow()
    expect(decryptSecret("anything")).toBeNull()
  })
})
