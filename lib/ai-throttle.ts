import "server-only"

// Process-wide gate for every OpenAI request the app makes. The whole app runs
// on one Fanvue org key, so this is the single choke point protecting the org's
// rate limit — there is no path around it. A
// single reply is not one request: the pipeline fires 3-5 calls per conversation
// (gate -> optional vision-evidence -> generation -> verifier). Bulk "Generate
// AI replies" runs several of those back to back, and it races the 15s
// background backfill in /api/reply-queue and the webhook pipeline — with
// nothing coordinating them they stampede the org's rate limit and 429. A 429
// then fails the draft silently (no suggestion row is written), so the
// "Drafting…" placeholder in the Queue hangs until its 20-min localStorage TTL.
// That is the "impossible to use" symptom.
//
// Every caller passes through here (lib/draft-ai, lib/playbook-gate,
// lib/automation/prestage, lib/triage/expand, the AI chat tool loop). It bounds
// both:
//   • concurrency        — at most AI_MAX_CONCURRENCY requests in flight, and
//   • starts-per-window   — at most AI_MAX_PER_WINDOW starts per rolling
//                           AI_WINDOW_MS, a backstop under the org's limit.
//
// In-process singleton: it coordinates within one Node instance (this app runs
// as a single server / Electron main process). If it is ever deployed across
// multiple lambdas this needs a shared store (Redis) instead — see the caveat in
// the reply-queue plan.

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

// On OpenAI the binding constraint is tokens-per-minute for the org's usage
// tier, not requests-per-minute — and our prompts are large (full system prompt
// + playbook + KB articles). These defaults are deliberately conservative
// rather than derived from a published number: read the real limits for this key
// off the OpenAI dashboard and raise them via env. Concurrency is usually what
// actually binds, since streamed generations run for several seconds each.
export const AI_THROTTLE_LIMITS = {
  maxConcurrency: Math.max(1, numberFromEnv("AI_MAX_CONCURRENCY", 6)),
  maxPerWindow: Math.max(1, numberFromEnv("AI_MAX_PER_WINDOW", 90)),
  windowMs: Math.max(1_000, numberFromEnv("AI_WINDOW_MS", 60_000)),
} as const

// Polling cadence while blocked purely on concurrency (a released slot has no
// timestamp to wake on). Cheap at this volume; capped by the window otherwise.
const CONCURRENCY_POLL_MS = 60

let inFlight = 0
// Monotonic-enough start timestamps within the current rolling window.
const starts: number[] = []

function prune(now: number): void {
  const cutoff = now - AI_THROTTLE_LIMITS.windowMs
  while (starts.length > 0 && starts[0] <= cutoff) starts.shift()
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    if (!signal) return
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(new DOMException("Aborted", "AbortError"))
      },
      { once: true }
    )
  })
}

// Wait until both a concurrency slot and a window token are free, then claim
// them. MUST be paired with exactly one releaseAiSlot() in a finally. Honours
// an abort signal so a cancelled generation stops queueing immediately.
export async function acquireAiSlot(signal?: AbortSignal): Promise<void> {
  const { maxConcurrency, maxPerWindow, windowMs } = AI_THROTTLE_LIMITS
  for (;;) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
    const now = Date.now()
    prune(now)
    if (inFlight < maxConcurrency && starts.length < maxPerWindow) {
      inFlight++
      starts.push(now)
      return
    }
    // Window-bound: wait exactly until the oldest start ages out. Concurrency-
    // bound only: poll shortly — a release carries no timestamp to wake on.
    let waitMs = CONCURRENCY_POLL_MS
    if (starts.length >= maxPerWindow && starts.length > 0) {
      waitMs = Math.max(waitMs, starts[0] + windowMs - now)
    }
    await sleep(Math.min(waitMs, windowMs), signal)
  }
}

export function releaseAiSlot(): void {
  if (inFlight > 0) inFlight--
}

// Convenience wrapper for the non-streaming callers (gate, prestage, keyword
// expansion): acquire a slot, run fn, release no matter how fn settles.
// Streaming callers can't use this — they must hold the slot across the whole
// stream — so they call acquire/release directly.
export async function withAiSlot<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  await acquireAiSlot(signal)
  try {
    return await fn()
  } finally {
    releaseAiSlot()
  }
}

// Parse a Retry-After header (delta-seconds or an HTTP date) into a ms delay.
// Returns null when absent/unparseable so the caller falls back to backoff.
export function parseRetryAfterMs(raw: string | null | undefined): number | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed === "") return null
  const secs = Number(trimmed)
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000)
  const dateMs = Date.parse(trimmed)
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now())
  return null
}

// ── Shared OpenAI fetch ─────────────────────────────────────────────────────

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
// Overridable so the app can be pointed at an Azure / gateway OpenAI-compatible
// endpoint without a code change. Must include the /v1 suffix.
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"

export function openaiBaseUrl(): string {
  return OPENAI_BASE_URL
}

export function openaiApiKey(): string | undefined {
  return OPENAI_API_KEY
}

/** Thin wrapper around fetch() that adds the shared OpenAI auth header and base
    URL. Returns a plain Response; the caller reads the body as needed. */
export function openaiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${OPENAI_BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`
  return fetch(url, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
  })
}
