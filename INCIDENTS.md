# Incident Log

A record of production bugs, their root causes, and fixes — to avoid repeating the same mistakes.

---

## INC-001 · 2026-06-07 · `MIDDLEWARE_INVOCATION_FAILED` — `__dirname` in Edge Runtime

**Symptom**
All requests returned `500: INTERNAL_SERVER_ERROR` with code `MIDDLEWARE_INVOCATION_FAILED`.
Vercel runtime logs (source: `edge-middleware`):
```
ReferenceError: __dirname is not defined
```

**Root cause**
Next.js 16's edge middleware adapter imports `getTracer()` which pulls in
`next/dist/compiled/@opentelemetry/api`. That package is ncc-compiled and contains:
```js
if (typeof __nccwpck_require__ !== "undefined") __nccwpck_require__.ab = __dirname + "/"
```
In Next.js dev (webpack), this is polyfilled via `eval("var __dirname = \"/\"; ...")`.
In the **Vercel production webpack build** the polyfill is absent, so the Edge Runtime
throws at module initialisation before any user code runs.

**Fix**
1. Renamed `middleware.ts` → `proxy.ts`, export `middleware` → `proxy`.
   Next.js 16 deprecated the `middleware` file convention; `proxy.ts` is the replacement.
2. Added webpack config in `next.config.ts` to polyfill `__dirname` for the edge target:
   ```ts
   webpack: (config, { nextRuntime }) => {
     if (nextRuntime === "edge") {
       config.node = { ...config.node, __dirname: "mock" }  // sets __dirname = "/"
     }
     return config
   }
   ```

**Follow-up (same deploy):** Adding a `webpack` config without a `turbopack` config caused
a second build failure — Next.js 16 on Vercel uses Turbopack by default and treats this as
an error. Removed the webpack polyfill (unnecessary for Turbopack, which handles `__dirname`
correctly) and added `turbopack: {}` to `next.config.ts` to explicitly declare Turbopack support.

**How to avoid in future**
- When upgrading Next.js major versions, check the build output for deprecation warnings
  (`⚠ The "middleware" file convention is deprecated`) — treat them as blockers.
- Keep `proxy.ts` (and future edge entry-points) import-free from any Node.js packages;
  even transitive `__dirname` / `__filename` references crash the Edge Runtime silently
  in production webpack builds while passing in dev.
- If a new edge entry starts failing with `__dirname`/`__filename` errors, add the
  matching `config.node` polyfill to the `nextRuntime === "edge"` block in `next.config.ts`.

---

## INC-002 · 2026-08-12 · Triage sweep cron never ran — `proxy.ts` redirected it to `/login`

**Symptom**
`triage_items` was empty (0 rows, `swept_at` null) even though `cron.job` listed
`triage-sweep-5min` as active and `cron.job_run_details` reported `succeeded` on every
single run. The Triage panel only ever had content right after somebody pressed
"Sweep now" by hand, and it emptied again afterwards.

**Root cause**
`proxy.ts` allowlisted machine-to-machine routes by exact path:
```ts
pathname === "/api/automation/sweep" ||
pathname === "/api/cron/refresh-metrics" ||
pathname.startsWith("/api/webhooks/")
```
`/api/cron/triage-sweep` was never added, so every pg_cron call was redirected to
`/login` before reaching the handler and its `CRON_SECRET` check. `/api/cron/reindex-knowledge`
had the same gap.

Nothing surfaced this because **both layers report success for a failed run**:
- `cron.job_run_details.status = 'succeeded'` only means `net.http_post` queued the
  request, not that the HTTP call did anything useful.
- `net._http_response.status_code = 200` — because the redirect was followed and the
  **login page HTML** came back with a normal 200. The only tell is that the response
  body is `<!DOCTYPE html>...` instead of the route's JSON.

**Fix**
Allowlist by prefix, so a new cron route can't silently be born broken:
```ts
pathname.startsWith("/api/cron/")
```
Safe as a prefix because every route under `/api/cron/` checks `CRON_SECRET` itself and
401s when it is absent or wrong.

**How to avoid in future**
- Never verify a cron by its pg_cron status. Check the response body:
  ```sql
  select status_code, left(content, 120), created
  from net._http_response order by created desc limit 10;
  ```
  A body starting with `<!DOCTYPE html>` means the call was redirected to `/login`.
- When adding any machine-called endpoint, confirm it is covered by `isMachineRoute`
  in `proxy.ts` in the same change that registers the cron job.
- A route that authenticates by shared secret should be reachable without a session by
  construction (prefix rule), never by remembering to add one more `===` branch.
