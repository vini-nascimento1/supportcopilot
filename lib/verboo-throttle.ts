import "server-only"

// Process-wide gate for every Verboo request. The upstream router enforces a
// hard rate limit (~30 req/min), and a single reply is NOT one request: the
// pipeline fires 3-5 Verboo calls per conversation (gate -> optional vision ->
// generation -> verifier). Bulk "Generate AI replies" runs several of those
// back to back, and it races the 15s background backfill in /api/reply-queue and
// the webhook pipeline — with nothing coordinating them they stampede past the
// limit and 429. A 429 then fails the draft silently (no suggestion row is
// written), so the "Drafting…" placeholder in the Queue hangs until its 20-min
// localStorage TTL. That is the "impossible to use" symptom.
//
// This module is the single choke point EVERY Verboo caller must pass through
// (lib/draft-ai, lib/playbook-gate, lib/automation/prestage). It bounds both:
//   • concurrency        — at most VERBOO_MAX_CONCURRENCY requests in flight, and
//   • starts-per-window   — at most VERBOO_MAX_PER_WINDOW starts per rolling
//                           VERBOO_WINDOW_MS, a backstop under the router's limit.
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

// Defaults sit under the 30/min ceiling with headroom for the occasional retry.
// Concurrency is usually the binding constraint (streamed generations run for
// several seconds each), which keeps us comfortably below the window cap.
const MAX_CONCURRENCY = Math.max(1, numberFromEnv("VERBOO_MAX_CONCURRENCY", 3))
const MAX_PER_WINDOW = Math.max(1, numberFromEnv("VERBOO_MAX_PER_WINDOW", 25))
const WINDOW_MS = Math.max(1_000, numberFromEnv("VERBOO_WINDOW_MS", 60_000))
// Polling cadence while blocked purely on concurrency (a released slot has no
// timestamp to wake on). Cheap at this volume; capped by the window otherwise.
const CONCURRENCY_POLL_MS = 60

let inFlight = 0
// Monotonic-enough start timestamps within the current rolling window.
const starts: number[] = []

function prune(now: number): void {
  const cutoff = now - WINDOW_MS
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
// them. MUST be paired with exactly one releaseVerbooSlot() in a finally. Honours
// an abort signal so a cancelled generation stops queueing immediately.
export async function acquireVerbooSlot(signal?: AbortSignal): Promise<void> {
  for (;;) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
    const now = Date.now()
    prune(now)
    if (inFlight < MAX_CONCURRENCY && starts.length < MAX_PER_WINDOW) {
      inFlight++
      starts.push(now)
      return
    }
    // Window-bound: wait exactly until the oldest start ages out. Concurrency-
    // bound only: poll shortly — a release carries no timestamp to wake on.
    let waitMs = CONCURRENCY_POLL_MS
    if (starts.length >= MAX_PER_WINDOW && starts.length > 0) {
      waitMs = Math.max(waitMs, starts[0] + WINDOW_MS - now)
    }
    await sleep(Math.min(waitMs, WINDOW_MS), signal)
  }
}

export function releaseVerbooSlot(): void {
  if (inFlight > 0) inFlight--
}

// Convenience wrapper for the non-streaming callers (gate, prestage): acquire a
// slot, run fn, release no matter how fn settles. Streaming callers can't use
// this — they must hold the slot across the whole stream — so they call
// acquire/release directly.
export async function withVerbooSlot<T>(
  fn: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  await acquireVerbooSlot(signal)
  try {
    return await fn()
  } finally {
    releaseVerbooSlot()
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
