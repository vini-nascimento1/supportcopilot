/**
 * Image attachment encoder for vision-capable AI drafting.
 *
 * Intercom conversation parts can carry file attachments. When a customer
 * sends a screenshot, we want the OpenAI-compatible vision model to be able to
 * "see" it. Models read images inline as `data:` URIs, so this module downloads
 * the raw bytes of image attachments and returns them base64-encoded.
 *
 * SERVER-ONLY. This downloads attachment bytes over the network and uses the
 * Node `Buffer` global to base64-encode them — it must run in the Node runtime,
 * never on the edge or in the browser.
 *
 * It is intentionally defensive: a bad, oversized, slow, or missing attachment
 * is silently skipped and never throws. A failure to encode one image must
 * never break the whole draft flow.
 */
import "server-only"

import type { ConversationAttachment } from "@/lib/intercom"

/** Process at most this many image attachments across all messages. */
const MAX_IMAGES = 4
/** Skip any image larger than this (declared filesize or actual byte length). */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
/** Abort a single attachment download that takes longer than this. */
const DOWNLOAD_TIMEOUT_MS = 8000
/** Fetch a few extra candidates beyond MAX_IMAGES so a transient download
 *  failure doesn't silently drop a usable image. */
const DOWNLOAD_OVERFETCH = 2

export type EncodedImage = { name: string; dataUri: string }

/**
 * Map of supported image content types. Keys are lowercased, normalized MIME
 * types we are willing to inline into a vision prompt.
 */
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
])

/**
 * Map a file extension (lowercased, no dot) to a normalized image MIME type.
 * `jpg` collapses to `image/jpeg`.
 */
const EXTENSION_TO_TYPE: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
}

/**
 * Resolve a supported, normalized image MIME type for an attachment, or `null`
 * if it is not a supported image.
 *
 * Prefers the declared `contentType`; if that is empty/unknown, infers from the
 * URL's file extension. Returns `null` when neither yields a supported type.
 */
function resolveImageContentType(attachment: ConversationAttachment): string | null {
  const declared = attachment.contentType.trim().toLowerCase()
  if (declared) {
    // Normalize jpg → jpeg (Intercom shouldn't send this, but be safe).
    const normalized = declared === "image/jpg" ? "image/jpeg" : declared
    if (SUPPORTED_IMAGE_TYPES.has(normalized)) return normalized
    // Declared but unsupported (e.g. application/pdf) — reject outright.
    return null
  }

  // No declared type: infer from the URL extension.
  const ext = extensionFromUrl(attachment.url)
  if (!ext) return null
  return EXTENSION_TO_TYPE[ext] ?? null
}

/**
 * Guard against SSRF: only fetch `https:` URLs on public hosts. Intercom serves
 * attachments from public https CDNs, so rejecting loopback / link-local /
 * private IP literals (and `localhost`) blocks the dangerous targets — cloud
 * metadata (169.254.169.254), localhost services — without dropping real
 * attachments. Best-effort only: it does not resolve DNS, so a hostname that
 * resolves to a private IP is not caught here (the URLs originate from the
 * authenticated Intercom API, not raw customer input).
 */
function isPubliclyFetchableUrl(rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (url.protocol !== "https:") return false
  const host = url.hostname.toLowerCase()
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return false
  }
  return !isPrivateIpLiteral(host)
}

/** True if `host` is an IPv4/IPv6 literal in a loopback/link-local/private range. */
function isPrivateIpLiteral(host: string): boolean {
  // URL.hostname strips the brackets from IPv6 literals (e.g. "::1").
  if (host.includes(":")) {
    return (
      host === "::1" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe80")
    )
  }
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false // a hostname, not an IP literal — can't classify without DNS
  const a = Number(m[1])
  const b = Number(m[2])
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true // link-local, incl. the 169.254.169.254 metadata IP
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

/** Extract the lowercased file extension (no dot) from a URL, or `null`. */
function extensionFromUrl(url: string): string | null {
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    // Not an absolute URL — fall back to the raw string, stripping any query.
    pathname = url.split(/[?#]/, 1)[0] ?? url
  }
  const lastDot = pathname.lastIndexOf(".")
  if (lastDot === -1 || lastDot === pathname.length - 1) return null
  return pathname.slice(lastDot + 1).toLowerCase()
}

/**
 * Download one image attachment and return it as a base64 `data:` URI, or
 * `null` if it should be skipped (unsupported, too large, network error,
 * timeout, non-OK response). Never throws.
 */
async function encodeOne(attachment: ConversationAttachment): Promise<EncodedImage | null> {
  const contentType = resolveImageContentType(attachment)
  if (!contentType) return null

  // Refuse to fetch non-https / internal-host URLs (SSRF guard).
  if (!isPubliclyFetchableUrl(attachment.url)) return null

  // Skip oversized attachments before spending a download on them.
  if (attachment.filesize > 0 && attachment.filesize > MAX_IMAGE_BYTES) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
  try {
    const res = await fetch(attachment.url, { signal: controller.signal })
    if (!res.ok) return null

    const buf = await res.arrayBuffer()
    if (buf.byteLength > MAX_IMAGE_BYTES) return null

    const b64 = Buffer.from(buf).toString("base64")
    const dataUri = `data:${contentType};base64,${b64}`
    return { name: attachment.name || "image", dataUri }
  } catch {
    // Timeout, network failure, 404 already handled, abort — skip this image.
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Download and base64-encode up to {@link MAX_IMAGES} of the CUSTOMER's image
 * attachments, preferring the most recent, for inlining into a vision prompt.
 *
 * Only customer attachments are used: an agent's earlier attachments would be
 * fed back to the model and mislabeled ("the customer attached…"). Duplicate
 * URLs are de-duped (Intercom can echo an attachment across `source` and a
 * part). Downloads run concurrently to bound worst-case latency to roughly a
 * single timeout rather than N × timeout.
 *
 * Robustness contract: a single bad attachment is skipped, not fatal; this
 * function always resolves and never rejects.
 */
export async function encodeImageAttachments(
  messages: { role?: string; attachments: ConversationAttachment[] }[],
): Promise<EncodedImage[]> {
  // Customer-only, images-only, in chronological order.
  const customerImages = messages
    .filter((message) => message.role === "customer")
    .flatMap((message) => message.attachments)
    .filter((attachment) => resolveImageContentType(attachment) !== null)

  // Dedupe by URL.
  const seen = new Set<string>()
  const unique = customerImages.filter((attachment) => {
    if (seen.has(attachment.url)) return false
    seen.add(attachment.url)
    return true
  })

  // Prefer the most recent images, over-fetching a little to tolerate failures,
  // then download the candidates concurrently.
  const candidates = unique.slice(-(MAX_IMAGES + DOWNLOAD_OVERFETCH))
  const settled = await Promise.all(candidates.map((attachment) => encodeOne(attachment)))
  const encoded = settled.filter((image): image is EncodedImage => image !== null)

  // Keep the most recent successes, in chronological order.
  return encoded.slice(-MAX_IMAGES)
}
