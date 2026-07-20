import "server-only"

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

// AES-256-GCM encryption for per-agent personal AI keys stored at rest in the
// `agents` table. The master key comes from PROVIDER_ENCRYPTION_KEY (32 bytes,
// hex or base64) so a database dump alone never exposes a usable API key. The
// plaintext key is only ever decrypted server-side, at the moment we build an
// outbound AI request — it is never returned to the client or logged.
//
// Ciphertext format (base64 of):  [12-byte IV][16-byte GCM tag][ciphertext]

const ALGO = "aes-256-gcm"
const IV_BYTES = 12
const TAG_BYTES = 16

// Parse a 32-byte key from hex (64 chars) or base64. Returns null when the env
// var is missing or malformed so callers can fail closed rather than store a
// secret with a weak/no key.
function loadMasterKey(): Buffer | null {
  const raw = process.env.PROVIDER_ENCRYPTION_KEY
  if (!raw) return null
  const trimmed = raw.trim()
  let key: Buffer
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    key = Buffer.from(trimmed, "hex")
  } else {
    try {
      key = Buffer.from(trimmed, "base64")
    } catch {
      return null
    }
  }
  return key.length === 32 ? key : null
}

/** True when a valid 32-byte PROVIDER_ENCRYPTION_KEY is configured. */
export function providerCryptoAvailable(): boolean {
  return loadMasterKey() !== null
}

/**
 * Encrypt a plaintext secret. Throws if PROVIDER_ENCRYPTION_KEY is unset/invalid
 * — we never persist a secret we can't protect.
 */
export function encryptSecret(plaintext: string): string {
  const key = loadMasterKey()
  if (!key) {
    throw new Error("PROVIDER_ENCRYPTION_KEY is not configured (need 32 bytes hex or base64)")
  }
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ciphertext]).toString("base64")
}

/**
 * Decrypt a value produced by encryptSecret. Returns null on any failure
 * (missing key, tampered ciphertext, wrong master key) so callers degrade to
 * the shared provider instead of throwing mid-request.
 */
export function decryptSecret(encoded: string): string | null {
  const key = loadMasterKey()
  if (!key) return null
  try {
    const buf = Buffer.from(encoded, "base64")
    if (buf.length < IV_BYTES + TAG_BYTES + 1) return null
    const iv = buf.subarray(0, IV_BYTES)
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
    const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES)
    const decipher = createDecipheriv(ALGO, key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
  } catch {
    return null
  }
}
