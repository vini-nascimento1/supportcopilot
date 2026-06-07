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
