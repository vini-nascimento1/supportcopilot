# Unified Conversation Card Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Backend/logic tasks are TDD (vitest). UI tasks have no component-test harness in this repo, so they are verified manually with the dev server — this is the established pattern (all existing tests live in `lib/`).

**Goal:** Merge the canvas Conversation, Draft, and Copilot cards into one "conversation & reply" card that replies to Intercom like a live chat — with an AI menu (Generate / Improve), a Copilot insight panel, and inbound/outbound image+file attachments — without removing copilot or draft functionality.

**Architecture:** The existing `ConversationNode` (read-only thread) becomes the single reply surface: thread (polled every 15s) on top, a composer with paste-to-attach + an `✨ AI ▾` menu + Send at the bottom, and a Copilot button that opens an insight panel. The standalone `draft` and `ai` canvas nodes are retired (their logic relocates into the card / its hooks); general chat stays on the page-wide FAB. Outbound attachments use Intercom's `attachment_files` (base64 inline) on the existing human-gated `/api/draft/send`. Draft-only/human-gated posture (ADR-0011) is preserved: nothing is sent without an explicit click.

**Tech Stack:** Next.js 16 (App Router, React 19), `@xyflow/react` canvas, Verboo router (`deepseek-v4-flash` text / `qwen3.6-27b` vision), Intercom REST `2.11`, Supabase, vitest.

---

## Decisions locked in the grill (source of truth for this plan)

| # | Decision |
|---|---|
| Surface | Merge Conversation + Draft into ONE card; Copilot becomes a button → panel |
| Copilot | Click → panel + **auto case-brief** on first open, then chat; brief cached per conversation + "refresh insight" |
| AI menu | `✨ AI ▾` next to Send: **Generate** (`/api/draft` from scratch) and **Improve** (new: refine current composer text, one-click, generic) |
| Queue | If a pending suggestion exists, **prefill** the composer; Send resolves the queue row (approve/edit) |
| Generate overwrite | Always replaces composer content, **no confirm** |
| Old nodes | `draft` + `ai` nodes **retired** everywhere (layout + toolbox + nodeTypes); general chat = FAB only |
| Attachments | **Full** this iteration. Outbound via `attachment_files` base64. Composer sends any allowed file; Copilot reads images only (qwen vision; PDF not readable) |
| Send safety | **Visual guards only** — thumbnail chips + remove + clear-after-send + `Send · 📎N` badge. No undo, no confirm. (One residual gap: fat-finger send; accepted.) |
| needs_check | Preserve the queue's **double-confirm** for `needs_check` suggestions only; everything else 1-click |
| Polling | Thread polls **~15s**, pauses when card hidden, + manual refresh button. Poll never touches the composer |
| Scope | **Canvas only**; `/cases/[id]` stays a read view |

Out of scope: real-time/websockets, `/cases/[id]` reply surface, AI reading PDFs.

---

## Conventions (read once)

- **Run tests (this sandbox):** vitest dies on SIGTTOU here. Use:
  ```bash
  trap '' TTOU TTIN; npx vitest run <file> < /dev/null
  ```
  Outside the sandbox `npx vitest run <file>` is fine.
- **Dev server (UI verification):** `npm run dev` then open `http://localhost:3000`, sign in, open a case canvas.
- **Typecheck / lint:** `npm run typecheck` · `npm run lint`
- **Commit author footer (required):**
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- **Branch:** `git checkout -b feat/unified-conversation-card` before Task 1.

---

## File Structure

**Modify (backend/logic):**
- `lib/draft-ai.ts` — add `buildImproveSystemPrompt`, `buildImproveUserMessage`.
- `app/api/draft/route.ts` — accept `mode: "improve"` + `currentDraft`.
- `app/api/draft/send/route.ts` — accept `attachmentFiles`; forward `attachment_files`. Extract pure `buildIntercomReplyPayload`.
- `app/api/ai/case-chat/route.ts` — accept pasted `images`; route image turns to qwen vision.

**Create (client):**
- `lib/reply-attachments.ts` — pure helpers: `fileToAttachment`, `MAX_OUTBOUND_FILES`, allowed-type check.
- `components/canvas/use-reply-composer.ts` — hook: draft text, attachments, generate/improve/send.
- `components/canvas/attachment-chips.tsx` — thumbnail/icon chips with remove.
- `components/canvas/composer-bar.tsx` — textarea + paste + `✨ AI ▾` menu + Send + badge.
- `components/canvas/copilot-panel.tsx` — Copilot insight/chat panel (relocated from `ai-node.tsx` + auto-brief + image paste).
- `components/canvas/conversation-reply-node.tsx` — the unified card (replaces `conversation-node.tsx`).
- `app/api/reply-queue/for-conversation/route.ts` — GET the pending suggestion for one conversation id (prefill).

**Modify (canvas wiring):**
- `components/canvas/case-canvas.tsx` — `nodeTypes`, `buildDefaultLayout`, `loadLayout`, toolbox; remove `draft`/`ai`.

**Retire (delete after logic relocated):**
- `components/canvas/draft-node.tsx`, `components/canvas/ai-node.tsx`, `components/draft-panel.tsx`, `components/canvas/conversation-node.tsx`.

**Docs:**
- `FanvueSupport/Engineering/Decisions/ADR-0018 Unified conversation card with outbound attachments.md` (vault; not git).

---

## Phase 1 — Backend (TDD)

### Task 1: `Improve` prompt builders in `lib/draft-ai.ts`

**Files:**
- Modify: `lib/draft-ai.ts`
- Test: `lib/draft-ai.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `lib/draft-ai.test.ts` (import `buildImproveSystemPrompt`, `buildImproveUserMessage` in the existing import block):

```ts
describe("buildImproveSystemPrompt", () => {
  it("instructs to improve an existing draft and keep English + policy", () => {
    const out = buildImproveSystemPrompt("Vini").toLowerCase()
    expect(out).toContain("improve")
    expect(out).toContain("english only")
    expect(out).toContain("do not")
    expect(out).toContain("only the")
  })
})

describe("buildImproveUserMessage", () => {
  const convo = { customer: "Jane", firstMessage: "payout failed", messages: [{ role: "customer", body: "still stuck" }] }
  it("embeds the current draft and the thread", () => {
    const out = buildImproveUserMessage(convo, "hey we cant change payout now")
    expect(out).toContain("hey we cant change payout now")
    expect(out).toContain("Current draft to improve")
    expect(out).toContain("still stuck")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
trap '' TTOU TTIN; npx vitest run lib/draft-ai.test.ts < /dev/null
```
Expected: FAIL — `buildImproveSystemPrompt is not a function`.

- [ ] **Step 3: Implement** — add to `lib/draft-ai.ts` directly below `buildUserMessage` (and export):

```ts
// ── Improve-an-existing-draft builders ─────────────────────────────────────

export function buildImproveSystemPrompt(agentName: string): string {
  return `You are a support copilot for ${agentName}, a senior support agent at Fanvue.

Your task: IMPROVE the existing customer-facing reply draft provided below — do not write a new reply from scratch.

## How to improve
- Keep the draft's meaning, facts, policy, and intent EXACTLY. Never add policy, promises, timelines, or steps that aren't already there.
- Improve tone (warm, personal, first-person, Fanvue voice), clarity, flow, and completeness.
- Light emoji (👋 😊 💛) — 1-2 max, never forced. Use **bold** for key steps; short bullet lists (4 max).
- Do not greet again if the thread shows an agent already replied.

## Critical constraints
- Output ONLY the improved customer-facing message text — ready to copy-paste. No "Here's the improved version:", no headers, no commentary.
- The output IS markdown.
- Never use the customer's real name.
- **Write in English only**, regardless of the conversation's language.`
}

export function buildImproveUserMessage(
  conversation: {
    customer: string
    firstMessage: string
    messages: { role: string; body: string }[]
  },
  currentDraft: string
): string {
  const parts = [`Customer: ${conversation.customer}`, `\nConversation thread:`]
  parts.push(`Customer: ${conversation.firstMessage}`)
  for (const msg of conversation.messages) {
    if (!msg.body.trim()) continue
    parts.push(`${msg.role === "admin" ? "Agent" : "Customer"}: ${msg.body}`)
  }
  parts.push(`\n## Current draft to improve\n${currentDraft}`)
  parts.push(`\nRewrite the draft above per the rules. Output only the improved message.`)
  return parts.join("\n")
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
trap '' TTOU TTIN; npx vitest run lib/draft-ai.test.ts < /dev/null
```
Expected: PASS (the 2 pre-existing macro tests still fail — unrelated, ignore).

- [ ] **Step 5: Commit**

```bash
git add lib/draft-ai.ts lib/draft-ai.test.ts
git commit -m "feat: add Improve-draft prompt builders to draft-ai

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `Improve` mode on `/api/draft`

**Files:**
- Modify: `app/api/draft/route.ts`

Improve is lighter than generate: it skips the article/Notion fetch (it's polishing existing text, not researching). It reuses the streaming machinery and `selectModel` (so a draft with no images stays on flash).

- [ ] **Step 1: Add imports** — extend the `@/lib/draft-ai` import in `app/api/draft/route.ts` to include the new builders:

```ts
import {
  buildSystemPrompt,
  buildNotionAwareSystemPrompt,
  buildUserMessage,
  buildImproveSystemPrompt,
  buildImproveUserMessage,
  streamChatCompletion,
} from "@/lib/draft-ai"
```

- [ ] **Step 2: Parse the new body fields** — replace the body-parse block (currently lines ~34-44) with:

```ts
  let body: { conversationId?: string; playbookId?: string; mode?: "generate" | "improve"; currentDraft?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return new Response("Invalid JSON body", { status: 400 })
  }

  const { conversationId, playbookId, mode, currentDraft } = body
  if (!conversationId) {
    return new Response("conversationId is required", { status: 400 })
  }
  if (mode === "improve" && !currentDraft?.trim()) {
    return new Response("currentDraft is required to improve", { status: 400 })
  }
```

- [ ] **Step 3: Branch the prompt build for improve** — replace the grounding/prompt block (currently lines ~69-90, from `// Fetch relevant Intercom...` through `const userMessage = ...`) with:

```ts
  const agentName = await getAgentName(email)

  let systemPrompt: string
  let userMessage: string | Awaited<ReturnType<typeof buildUserMessage>>

  if (mode === "improve") {
    // Improve = polish the current draft; skip article/Notion research.
    systemPrompt = buildImproveSystemPrompt(agentName)
    userMessage = buildImproveUserMessage(conversation, currentDraft as string)
  } else {
    const searchQuery = [conversation.subject, conversation.firstMessage].filter(Boolean).join(" ")
    const articles = await searchArticles(searchQuery)
    const { origin } = new URL(req.url)
    const snippets = await retrieveNotionSnippets(email, origin, searchQuery)
    systemPrompt =
      snippets.length > 0
        ? buildNotionAwareSystemPrompt(playbook, responseTemplates, agentName, articles, snippets)
        : buildSystemPrompt(playbook, responseTemplates, agentName, articles)
    const images = await encodeImageAttachments(conversation.messages)
    userMessage = buildUserMessage(conversation, images)
  }
```

  Note: `playbook`/`responseTemplates` are still computed above this block (lines ~61-67) — leave them; they're only read in the `else` branch, which is fine.

- [ ] **Step 4: Verify typecheck + manual smoke**

```bash
npm run typecheck
```
Expected: exit 0. Manual: in dev, the Improve action (Task 7) calls this with `mode:"improve"` and streams a refined draft.

- [ ] **Step 5: Commit**

```bash
git add app/api/draft/route.ts
git commit -m "feat: /api/draft supports improve mode (refine current draft)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Outbound attachments on `/api/draft/send`

**Files:**
- Modify: `app/api/draft/send/route.ts`
- Test: `app/api/draft/send/payload.test.ts` (new) + extract `app/api/draft/send/payload.ts` (new, pure)

- [ ] **Step 1: Write the failing test** — `app/api/draft/send/payload.ts` is a pure builder so it's unit-testable. Create `app/api/draft/send/payload.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { buildIntercomReplyPayload, MAX_OUTBOUND_FILES } from "./payload"

describe("buildIntercomReplyPayload", () => {
  it("builds a text-only comment reply", () => {
    const p = buildIntercomReplyPayload({ adminId: "42", htmlBody: "<p>hi</p>" })
    expect(p).toEqual({ type: "admin", message_type: "comment", admin_id: "42", body: "<p>hi</p>" })
    expect("attachment_files" in p).toBe(false)
  })

  it("attaches files as attachment_files (base64) when provided", () => {
    const p = buildIntercomReplyPayload({
      adminId: "42",
      htmlBody: "<p>here</p>",
      attachmentFiles: [{ name: "fix.png", contentType: "image/png", data: "AAA" }],
    })
    expect(p.attachment_files).toEqual([{ content_type: "image/png", name: "fix.png", data: "AAA" }])
  })

  it("caps the number of attachments at MAX_OUTBOUND_FILES", () => {
    const files = Array.from({ length: MAX_OUTBOUND_FILES + 3 }, (_, i) => ({ name: `f${i}.png`, contentType: "image/png", data: "AAA" }))
    const p = buildIntercomReplyPayload({ adminId: "42", htmlBody: "<p>x</p>", attachmentFiles: files })
    expect(p.attachment_files?.length).toBe(MAX_OUTBOUND_FILES)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
trap '' TTOU TTIN; npx vitest run app/api/draft/send/payload.test.ts < /dev/null
```
Expected: FAIL — cannot find `./payload`.

- [ ] **Step 3: Implement the pure builder** — create `app/api/draft/send/payload.ts`:

```ts
/** Max files Intercom accepts per reply is 10; we cap a little lower for safety. */
export const MAX_OUTBOUND_FILES = 8

export type OutboundFile = { name: string; contentType: string; data: string }

type IntercomReplyPayload = {
  type: "admin"
  message_type: "comment"
  admin_id: string
  body: string
  attachment_files?: { content_type: string; name: string; data: string }[]
}

export function buildIntercomReplyPayload(input: {
  adminId: string
  htmlBody: string
  attachmentFiles?: OutboundFile[]
}): IntercomReplyPayload {
  const payload: IntercomReplyPayload = {
    type: "admin",
    message_type: "comment",
    admin_id: input.adminId,
    body: input.htmlBody,
  }
  const files = (input.attachmentFiles ?? []).slice(0, MAX_OUTBOUND_FILES)
  if (files.length > 0) {
    payload.attachment_files = files.map((f) => ({
      content_type: f.contentType,
      name: f.name,
      data: f.data,
    }))
  }
  return payload
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
trap '' TTOU TTIN; npx vitest run app/api/draft/send/payload.test.ts < /dev/null
```
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the builder into the route** — in `app/api/draft/send/route.ts`: add the import, accept `attachmentFiles`, and replace the inline `body: JSON.stringify({...})`. Change the request parse (lines ~15-21) to:

```ts
  const { conversationId, body, html, attachmentFiles } = (await req.json()) as {
    conversationId: string
    body: string
    html?: boolean
    attachmentFiles?: { name: string; contentType: string; data: string }[]
  }

  if (!conversationId || (!body && !(attachmentFiles && attachmentFiles.length))) {
    return new Response("Missing conversationId or body", { status: 400 })
  }
```

  Add at the top with the other imports:

```ts
import { buildIntercomReplyPayload } from "./payload"
```

  Replace the fetch body (lines ~55-60) with:

```ts
    body: JSON.stringify(
      buildIntercomReplyPayload({ adminId: String(adminId), htmlBody, attachmentFiles })
    ),
```

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add app/api/draft/send/route.ts app/api/draft/send/payload.ts app/api/draft/send/payload.test.ts
git commit -m "feat: /api/draft/send forwards attachment_files to Intercom

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Copilot reads pasted images (`/api/ai/case-chat`)

**Files:**
- Modify: `app/api/ai/case-chat/route.ts` (read it fully first — ~165 lines; it uses `deepseek-v4-flash` with function-calling tools).

**Approach:** Accept an optional `images: { name, dataUri }[]` on the request. When the latest user turn has images, build that user message as multimodal content (text + `image_url` parts, exactly like `buildUserMessage` does) and call the model via `selectModel` so it routes to `qwen3.6-27b`. For image turns, skip the tool-calling path (qwen vision turn answers directly). Text-only turns keep the existing tool-calling flow unchanged.

- [ ] **Step 1: Add imports** to `app/api/ai/case-chat/route.ts`:

```ts
import { selectModel, type OpenAIMessage, type OpenAIContentPart } from "@/lib/draft-ai"
```

- [ ] **Step 2: Accept images on the body** — where the request JSON is parsed, add `images` to the destructure:

```ts
const { messages, conversationId, images } = (await req.json()) as {
  messages: { role: "user" | "assistant"; content: string }[]
  conversationId?: string
  images?: { name: string; dataUri: string }[]
}
```

- [ ] **Step 3: Build a multimodal last-user message when images are present** — just before the model call, construct the outgoing messages. Convert the latest user message to content-parts when `images?.length`:

```ts
const hasImages = Array.isArray(images) && images.length > 0
const outgoing: OpenAIMessage[] = messages.map((m, i) => {
  const isLastUser = i === messages.length - 1 && m.role === "user"
  if (isLastUser && hasImages) {
    const parts: OpenAIContentPart[] = [
      { type: "text", text: m.content || "What does the attached image show, in this case's context?" },
      ...images!.map((img) => ({ type: "image_url" as const, image_url: { url: img.dataUri } })),
    ]
    return { role: "user", content: parts }
  }
  return { role: m.role, content: m.content }
})
// Prepend the existing system prompt as today.
```

- [ ] **Step 4: Route image turns to vision (no tools)** — where the route currently builds its fetch with `model: "deepseek-v4-flash"` and `tools`, branch: when `hasImages`, use `model: selectModel(outgoing)` (→ qwen3.6-27b) and OMIT `tools` (vision turn answers directly); otherwise keep the existing tool-calling request unchanged. Use the existing system prompt + `outgoing` for the messages array.

- [ ] **Step 5: Verify** — `npm run typecheck` (exit 0). Manual smoke in dev after Task 8: paste an image into the Copilot, ask "what does this show?", confirm it reads it.

- [ ] **Step 6: Commit**

```bash
git add app/api/ai/case-chat/route.ts
git commit -m "feat: case-chat copilot reads pasted images (qwen vision)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Pending-suggestion lookup endpoint (queue → prefill)

**Files:**
- Create: `app/api/reply-queue/for-conversation/route.ts`

The card prefills the composer from the pending suggestion. Reuse the existing reply-queue store (same source `/api/reply-queue` reads). Read `app/api/reply-queue/route.ts` first to reuse its store import (e.g. `getPendingSuggestions` / equivalent) and auth pattern.

- [ ] **Step 1: Implement the GET route** — create `app/api/reply-queue/for-conversation/route.ts` (mirror the auth + store usage of `app/api/reply-queue/route.ts`):

```ts
import { type NextRequest } from "next/server"
import { getSignedInEmail } from "@/lib/auth"
import { getPendingSuggestionForConversation } from "@/lib/reply-queue-store"

export async function GET(req: NextRequest) {
  const email = await getSignedInEmail()
  if (!email) return new Response("Unauthorized", { status: 401 })
  const conversationId = new URL(req.url).searchParams.get("conversationId")
  if (!conversationId) return new Response("conversationId required", { status: 400 })
  const suggestion = await getPendingSuggestionForConversation(conversationId)
  return Response.json({ suggestion: suggestion ?? null })
}
```

  If `getPendingSuggestionForConversation` does not already exist in `lib/reply-queue-store.ts`, add a small wrapper there that selects the pending `suggested_replies` row for one `intercom_conversation_id` scoped to the signed-in agent (follow the existing select pattern in that file). Return `{ id, body, justification, sources, riskBand }` or null.

- [ ] **Step 2: Verify** — `npm run typecheck`; manual: `curl` while signed in (or check via the card in Task 9).

- [ ] **Step 3: Commit**

```bash
git add app/api/reply-queue/for-conversation/route.ts lib/reply-queue-store.ts
git commit -m "feat: endpoint to fetch the pending suggestion for one conversation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — Client logic + components

### Task 6: Attachment helpers + chips

**Files:**
- Create: `lib/reply-attachments.ts`
- Create: `components/canvas/attachment-chips.tsx`
- Test: `lib/reply-attachments.test.ts`

- [ ] **Step 1: Failing test** — `lib/reply-attachments.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { isImageType, MAX_OUTBOUND_FILES, ALLOWED_SEND_TYPES } from "./reply-attachments"

describe("reply-attachments", () => {
  it("recognizes images", () => {
    expect(isImageType("image/png")).toBe(true)
    expect(isImageType("application/pdf")).toBe(false)
  })
  it("allows images + pdf for sending", () => {
    expect(ALLOWED_SEND_TYPES.has("image/png")).toBe(true)
    expect(ALLOWED_SEND_TYPES.has("application/pdf")).toBe(true)
  })
  it("caps outbound files", () => {
    expect(MAX_OUTBOUND_FILES).toBe(8)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
trap '' TTOU TTIN; npx vitest run lib/reply-attachments.test.ts < /dev/null
```
Expected: FAIL — cannot find `./reply-attachments`.

- [ ] **Step 3: Implement** `lib/reply-attachments.ts`:

```ts
export const MAX_OUTBOUND_FILES = 8
export const MAX_OUTBOUND_BYTES = 10 * 1024 * 1024

export const ALLOWED_SEND_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
])

export function isImageType(ct: string): boolean {
  return ct.startsWith("image/")
}

export type ComposerAttachment = {
  id: string
  name: string
  contentType: string
  /** raw base64 (no data: prefix) — what Intercom attachment_files.data wants */
  data: string
  /** object URL for the thumbnail (images only); caller revokes on remove */
  previewUrl: string | null
  tooLarge: boolean
}

/** Read a File into a ComposerAttachment (base64 + preview). Browser-only. */
export async function fileToAttachment(file: File, id: string): Promise<ComposerAttachment> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  const data = btoa(binary)
  const contentType = file.type || "application/octet-stream"
  return {
    id,
    name: file.name || "attachment",
    contentType,
    data,
    previewUrl: isImageType(contentType) ? URL.createObjectURL(file) : null,
    tooLarge: file.size > MAX_OUTBOUND_BYTES,
  }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
trap '' TTOU TTIN; npx vitest run lib/reply-attachments.test.ts < /dev/null
```
Expected: PASS.

- [ ] **Step 5: Implement the chips component** — `components/canvas/attachment-chips.tsx`:

```tsx
"use client"

import { XIcon, FileIcon } from "lucide-react"
import type { ComposerAttachment } from "@/lib/reply-attachments"

export function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: ComposerAttachment[]
  onRemove: (id: string) => void
}) {
  if (attachments.length === 0) return null
  return (
    <div className="nodrag flex flex-wrap gap-1.5 px-1 pb-1">
      {attachments.map((a) => (
        <span
          key={a.id}
          className={
            "flex items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] " +
            (a.tooLarge ? "border-destructive/40 text-destructive" : "bg-muted/40")
          }
          title={a.tooLarge ? `${a.name} — too large (max 10MB)` : a.name}
        >
          {a.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.previewUrl} alt={a.name} className="size-5 rounded object-cover" />
          ) : (
            <FileIcon className="size-3.5" />
          )}
          <span className="max-w-28 truncate">{a.name}</span>
          <button onClick={() => onRemove(a.id)} title="Remove" className="text-muted-foreground hover:text-foreground">
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
    </div>
  )
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/reply-attachments.ts lib/reply-attachments.test.ts components/canvas/attachment-chips.tsx
git commit -m "feat: composer attachment helpers + thumbnail chips

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `useReplyComposer` hook

**Files:**
- Create: `components/canvas/use-reply-composer.ts`

Encapsulates draft text, attachments, and the generate/improve/send calls (relocating `DraftPanel`'s logic). `idCounter` avoids `Math.random`/`Date.now` (unavailable in some contexts) — use a ref counter.

- [ ] **Step 1: Implement the hook** — `components/canvas/use-reply-composer.ts`:

```ts
"use client"

import { useRef, useState, useCallback } from "react"
import { toast } from "sonner"
import { fileToAttachment, type ComposerAttachment } from "@/lib/reply-attachments"

type GenMode = "generate" | "improve"

export function useReplyComposer(opts: {
  conversationId: string
  playbookId?: string
  suggestionId?: string | null
  onSent?: () => void
}) {
  const [text, setText] = useState("")
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const [busy, setBusy] = useState<null | GenMode | "send">(null)
  const dirtyRef = useRef(false) // true once the user edited the text by hand
  const idRef = useRef(0)

  const setTextManual = useCallback((v: string) => {
    dirtyRef.current = true
    setText(v)
  }, [])

  const prefill = useCallback((body: string) => {
    // From the queue suggestion — not a manual edit.
    dirtyRef.current = false
    setText(body)
  }, [])

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files)
    const next: ComposerAttachment[] = []
    for (const f of arr) next.push(await fileToAttachment(f, `att-${idRef.current++}`))
    setAttachments((cur) => [...cur, ...next])
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((cur) => {
      const hit = cur.find((a) => a.id === id)
      if (hit?.previewUrl) URL.revokeObjectURL(hit.previewUrl)
      return cur.filter((a) => a.id !== id)
    })
  }, [])

  const clearAttachments = useCallback(() => {
    setAttachments((cur) => {
      cur.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl))
      return []
    })
  }, [])

  async function streamInto(mode: GenMode) {
    setBusy(mode)
    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: opts.conversationId,
          ...(opts.playbookId ? { playbookId: opts.playbookId } : {}),
          ...(mode === "improve" ? { mode: "improve", currentDraft: text } : {}),
        }),
      })
      if (!res.ok || !res.body) {
        toast.error((await res.text().catch(() => "")) || `Request failed (${res.status})`)
        return
      }
      // Generate replaces silently (decision: no confirm). Improve also replaces.
      dirtyRef.current = false
      setText("")
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let acc = ""
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
        setText(acc)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Network error")
    } finally {
      setBusy(null)
    }
  }

  const generate = useCallback(() => streamInto("generate"), [text, opts.conversationId, opts.playbookId])
  const improve = useCallback(() => {
    if (!text.trim()) return toast.error("Nothing to improve yet")
    return streamInto("improve")
  }, [text, opts.conversationId, opts.playbookId])

  const send = useCallback(async () => {
    if (busy) return
    const oversized = attachments.find((a) => a.tooLarge)
    if (oversized) return toast.error(`"${oversized.name}" is too large (max 10MB)`)
    if (!text.trim() && attachments.length === 0) return
    setBusy("send")
    try {
      const res = await fetch("/api/draft/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: opts.conversationId,
          body: text,
          attachmentFiles: attachments.map((a) => ({ name: a.name, contentType: a.contentType, data: a.data })),
        }),
      })
      if (!res.ok) {
        toast.error((await res.text().catch(() => "")) || `Failed to send (${res.status})`)
        return
      }
      // Resolve the queue row if this came from a suggestion.
      if (opts.suggestionId) {
        await fetch("/api/reply-queue/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: opts.conversationId,
            suggestionId: opts.suggestionId,
            action: dirtyRef.current ? "edit" : "approve",
            bodyChanged: dirtyRef.current,
          }),
        }).catch(() => {})
      }
      toast.success("Sent to Intercom ✅")
      setText("")
      clearAttachments()
      opts.onSent?.()
    } finally {
      setBusy(null)
    }
  }, [busy, text, attachments, opts, clearAttachments])

  return { text, setText: setTextManual, prefill, attachments, addFiles, removeAttachment, busy, generate, improve, send }
}
```

- [ ] **Step 2: Verify** — `npm run typecheck` (exit 0).

- [ ] **Step 3: Commit**

```bash
git add components/canvas/use-reply-composer.ts
git commit -m "feat: useReplyComposer hook (generate/improve/send + attachments)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `ComposerBar` component

**Files:**
- Create: `components/canvas/composer-bar.tsx`

- [ ] **Step 1: Implement** — `components/canvas/composer-bar.tsx`:

```tsx
"use client"

import { useRef } from "react"
import { SendIcon, SparklesIcon, Loader2Icon, PaperclipIcon, ChevronDownIcon } from "lucide-react"
import { Textarea } from "@/components/ui/textarea"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { AttachmentChips } from "@/components/canvas/attachment-chips"
import { ALLOWED_SEND_TYPES, isImageType } from "@/lib/reply-attachments"
import type { useReplyComposer } from "@/components/canvas/use-reply-composer"

type Composer = ReturnType<typeof useReplyComposer>

export function ComposerBar({ composer }: { composer: Composer }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const { text, setText, attachments, addFiles, removeAttachment, busy, generate, improve, send } = composer

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files).filter((f) => ALLOWED_SEND_TYPES.has(f.type))
    if (files.length) {
      e.preventDefault()
      void addFiles(files)
    }
  }

  const attCount = attachments.length

  return (
    <div className="nodrag flex shrink-0 flex-col gap-1 border-t p-2">
      <AttachmentChips attachments={attachments} onRemove={removeAttachment} />
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={onPaste}
        placeholder="Type a reply… (paste images/files to attach)"
        className="min-h-[64px] resize-y text-sm"
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={[...ALLOWED_SEND_TYPES].join(",")}
            className="hidden"
            onChange={(e) => e.target.files && void addFiles(e.target.files)}
          />
          <button
            onClick={() => fileRef.current?.click()}
            title="Attach file"
            className="rounded-md border p-1.5 text-muted-foreground hover:bg-muted/50"
          >
            <PaperclipIcon className="size-3.5" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={!!busy}
              className="flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 disabled:opacity-50"
            >
              {busy === "generate" || busy === "improve" ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <SparklesIcon className="size-3.5" />
              )}
              AI <ChevronDownIcon className="size-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => void generate()}>Generate a reply</DropdownMenuItem>
              <DropdownMenuItem onClick={() => void improve()}>Improve current reply</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <button
          onClick={() => void send()}
          disabled={busy === "send" || (!text.trim() && attCount === 0)}
          className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy === "send" ? <Loader2Icon className="size-3.5 animate-spin" /> : <SendIcon className="size-3.5" />}
          {busy === "send" ? "Sending…" : attCount > 0 ? `Send · 📎${attCount}` : "Send"}
        </button>
      </div>
    </div>
  )
}
```

  Note: if `@/components/ui/dropdown-menu` doesn't exist, add it via the shadcn skill (`npx shadcn@latest add dropdown-menu`) — verify first with `ls components/ui/dropdown-menu.tsx`. `isImageType` import is used by AttachmentChips indirectly; keep it if lint flags it unused, remove it.

- [ ] **Step 2: Verify** — `npm run typecheck` (exit 0).

- [ ] **Step 3: Commit**

```bash
git add components/canvas/composer-bar.tsx
git commit -m "feat: ComposerBar — textarea + paste-to-attach + AI menu + Send badge

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `CopilotPanel` component

**Files:**
- Create: `components/canvas/copilot-panel.tsx`

Relocates `ai-node.tsx`'s chat (transcript + input + `/api/ai/case-chat`), adds: (a) an **auto-brief** fired on first open if the transcript is empty, (b) **image paste** → sends `images` to case-chat (Task 4). Read `ai-node.tsx` for the exact transcript/markdown rendering to reuse.

- [ ] **Step 1: Implement** — `components/canvas/copilot-panel.tsx`. Reuse the `Message` type, the `MarkdownPreview` render, and the `send()` fetch from `ai-node.tsx`. Add:

```tsx
"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2Icon, RefreshCwIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { MarkdownPreview } from "@/components/markdown-preview"
import { fileToAttachment } from "@/lib/reply-attachments"

type Message = { role: "user" | "assistant"; content: string }
const AUTO_BRIEF = "Give me a tight brief on this case: what it is, the matching playbook, and the exact next steps."

export function CopilotPanel({
  conversationId,
  transcript,
  onTranscript,
}: {
  conversationId: string
  transcript: Message[]
  onTranscript: (m: Message[]) => void
}) {
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [pendingImages, setPendingImages] = useState<{ name: string; dataUri: string }[]>([])
  const listRef = useRef<HTMLDivElement>(null)
  const briefedRef = useRef(false)

  async function ask(text: string, images?: { name: string; dataUri: string }[]) {
    if (loading) return
    const updated: Message[] = [...transcript, { role: "user", content: text }]
    onTranscript(updated)
    setLoading(true)
    try {
      const res = await fetch("/api/ai/case-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updated, conversationId, images }),
      })
      const payload = await res.json()
      onTranscript([...updated, { role: "assistant", content: res.ok ? payload.message : (payload.error ?? "Something went wrong") }])
    } catch {
      onTranscript([...updated, { role: "assistant", content: "Network error." }])
    } finally {
      setLoading(false)
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }))
    }
  }

  // Auto-brief on first open if there's no transcript yet.
  useEffect(() => {
    if (!briefedRef.current && transcript.length === 0) {
      briefedRef.current = true
      void ask(AUTO_BRIEF)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onPaste = async (e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"))
    if (!imgs.length) return
    e.preventDefault()
    const encoded = await Promise.all(
      imgs.map(async (f, i) => {
        const a = await fileToAttachment(f, `ci-${i}`)
        return { name: a.name, dataUri: `data:${a.contentType};base64,${a.data}` }
      })
    )
    setPendingImages((cur) => [...cur, ...encoded])
  }

  const submit = () => {
    const text = input.trim()
    if (!text && pendingImages.length === 0) return
    setInput("")
    const imgs = pendingImages
    setPendingImages([])
    void ask(text || "What does this image show, in this case's context?", imgs.length ? imgs : undefined)
  }

  return (
    <div className="nodrag flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-2 py-1.5 text-xs font-medium text-muted-foreground">
        Copilot
        {loading && <Loader2Icon className="size-3 animate-spin" />}
        <button
          onClick={() => { briefedRef.current = true; void ask(AUTO_BRIEF) }}
          title="Refresh insight"
          className="ml-auto hover:text-foreground"
        >
          <RefreshCwIcon className="size-3" />
        </button>
      </div>
      <div ref={listRef} className="nowheel flex flex-1 flex-col gap-2 overflow-y-auto p-2 select-text">
        {transcript.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-6 self-end rounded-lg bg-primary px-2.5 py-1.5 text-xs text-primary-foreground">{m.content}</div>
          ) : (
            <div key={i} className="mr-1 self-start [&_.markdown-preview]:text-xs"><MarkdownPreview content={m.content} /></div>
          )
        )}
      </div>
      {pendingImages.length > 0 && (
        <div className="px-2 pb-1 text-[11px] text-muted-foreground">📎 {pendingImages.length} image(s) attached to your question</div>
      )}
      <div className="flex items-center gap-1.5 border-t p-2">
        <Input
          className="h-7 text-xs"
          placeholder="Ask about this case… (paste an image)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit() } }}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify** — `npm run typecheck` (exit 0).

- [ ] **Step 3: Commit**

```bash
git add components/canvas/copilot-panel.tsx
git commit -m "feat: CopilotPanel — auto case-brief + chat + image paste

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — The unified card

### Task 10: `ConversationReplyNode`

**Files:**
- Create: `components/canvas/conversation-reply-node.tsx`

Composes: header (subject + `🧠 Copilot` toggle + pin), polled thread (reuse `MessageBubble` from the old `conversation-node.tsx` — copy it in), `ComposerBar`, and a collapsible `CopilotPanel`. Polls the thread every 15s via the existing canvas refresh endpoint, pausing when the document is hidden. Prefills from the queue on mount.

- [ ] **Step 1: Implement** — `components/canvas/conversation-reply-node.tsx`:

```tsx
"use client"

import { useEffect, useRef, useState } from "react"
import { NodeResizer, useReactFlow, type Node, type NodeProps } from "@xyflow/react"
import { MessageSquareIcon, BrainIcon, RefreshCwIcon } from "lucide-react"
import { PinButton } from "@/components/canvas/pin-button"
import { ComposerBar } from "@/components/canvas/composer-bar"
import { CopilotPanel } from "@/components/canvas/copilot-panel"
import { useReplyComposer } from "@/components/canvas/use-reply-composer"

export interface ConversationMessageData {
  role: "customer" | "admin" | "ai"
  author: string
  body: string
  createdAt: string | null
  attachmentCount?: number
}

type CopilotMsg = { role: "user" | "assistant"; content: string }

export type ConversationReplyData = {
  subject: string | null
  messages: ConversationMessageData[]
  conversationId: string
  playbookId?: string
  playbookName?: string
  copilotTranscript?: CopilotMsg[]
}

export type ConversationReplyNodeType = Node<ConversationReplyData, "conversation">

const POLL_MS = 15000

function MessageBubble({ msg }: { msg: ConversationMessageData }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { void navigator.clipboard.writeText(msg.body); setCopied(true); setTimeout(() => setCopied(false), 1000) }}
      title="Click to copy"
      className={"nodrag cursor-pointer rounded-lg px-2.5 py-1.5 text-left transition-colors " +
        (msg.role === "customer" ? "mr-4 bg-muted hover:bg-muted/70" : "ml-4 bg-primary/10 hover:bg-primary/20")}
    >
      <p className="mb-0.5 text-[10px] font-medium text-muted-foreground">
        {msg.author}{msg.createdAt && ` · ${new Date(msg.createdAt).toLocaleString("en-GB", { timeZone: "Europe/London" })}`}
        {copied && " · copied"}
      </p>
      {msg.body.trim() && <p className="whitespace-pre-wrap text-xs leading-snug">{msg.body}</p>}
      {!!msg.attachmentCount && <p className="text-[10px] text-muted-foreground">📎 {msg.attachmentCount} attachment(s)</p>}
    </button>
  )
}

export function ConversationReplyNode({ id, data, selected }: NodeProps<ConversationReplyNodeType>) {
  const { updateNodeData } = useReactFlow()
  const [messages, setMessages] = useState<ConversationMessageData[]>(data.messages)
  const [showCopilot, setShowCopilot] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  // Server-provided data wins when the canvas rehydrates it.
  useEffect(() => { setMessages(data.messages) }, [data.messages])

  const composer = useReplyComposer({ conversationId: data.conversationId, playbookId: data.playbookId, suggestionId: suggestionIdRef.current })

  // Prefill from the pending queue suggestion (once).
  const prefilledRef = useRef(false)
  const suggestionIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (prefilledRef.current) return
    prefilledRef.current = true
    void (async () => {
      try {
        const res = await fetch(`/api/reply-queue/for-conversation?conversationId=${encodeURIComponent(data.conversationId)}`)
        const json = await res.json()
        if (json.suggestion?.body) {
          suggestionIdRef.current = json.suggestion.id
          composer.prefill(json.suggestion.body)
        }
      } catch { /* no suggestion → empty composer */ }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.conversationId])

  // Poll the thread (never the composer), paused when hidden.
  const refreshThread = async () => {
    setRefreshing(true)
    try {
      const res = await fetch(`/api/canvas/conversation?id=${encodeURIComponent(data.conversationId)}`)
      if (res.ok) {
        const json = await res.json()
        if (Array.isArray(json.messages)) setMessages(json.messages)
      }
    } finally { setRefreshing(false) }
  }
  useEffect(() => {
    const tick = () => { if (!document.hidden) void refreshThread() }
    const t = setInterval(tick, POLL_MS)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.conversationId])

  useEffect(() => {
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }))
  }, [messages.length])

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border bg-card shadow-md">
      <NodeResizer isVisible={selected} minWidth={340} minHeight={360} />
      <div className="flex h-9 shrink-0 cursor-grab items-center gap-2 border-b bg-muted/50 px-3 active:cursor-grabbing">
        <MessageSquareIcon className="size-3.5 text-muted-foreground" />
        <span className="truncate text-xs font-medium">{data.subject || "Conversation"}</span>
        <span className="nodrag ml-auto flex items-center gap-1">
          <button onClick={() => void refreshThread()} title="Refresh thread" className="text-muted-foreground hover:text-foreground">
            <RefreshCwIcon className={"size-3.5 " + (refreshing ? "animate-spin" : "")} />
          </button>
          <button
            onClick={() => setShowCopilot((v) => !v)}
            title="Copilot"
            className={"flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] " + (showCopilot ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted")}
          >
            <BrainIcon className="size-3.5" /> Copilot
          </button>
          <PinButton nodeId={id} />
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={listRef} className="nodrag nowheel flex flex-1 flex-col gap-3 overflow-y-auto p-3">
            {messages.length === 0 && <p className="m-auto text-xs text-muted-foreground">No messages.</p>}
            {messages.map((m, i) => <MessageBubble key={i} msg={m} />)}
          </div>
          <ComposerBar composer={composer} />
        </div>
        {showCopilot && (
          <div className="w-72 shrink-0 border-l">
            <CopilotPanel
              conversationId={data.conversationId}
              transcript={data.copilotTranscript ?? []}
              onTranscript={(m) => updateNodeData(id, { copilotTranscript: m })}
            />
          </div>
        )}
      </div>
    </div>
  )
}
```

  Note: `suggestionIdRef` is referenced in the `useReplyComposer` call before its declaration in source order — move the two `useRef` declarations (`prefilledRef`, `suggestionIdRef`) ABOVE the `useReplyComposer` call when implementing. Also confirm `app/api/canvas/conversation/route.ts` returns `{ messages }` shaped like `ConversationMessageData[]` (read it; the earlier map shows it returns the conversation node data). If it returns `{ subject, messages }`, adapt the setter. Add `attachmentCount` to that route's message mapping if you want the 📎 indicator live (optional; the `/cases/[id]` page already shows it).

- [ ] **Step 2: Verify** — `npm run typecheck` (exit 0).

- [ ] **Step 3: Commit**

```bash
git add components/canvas/conversation-reply-node.tsx
git commit -m "feat: ConversationReplyNode — unified thread + composer + copilot

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4 — Canvas wiring + retirement

### Task 11: Swap nodes in `case-canvas.tsx`

**Files:**
- Modify: `components/canvas/case-canvas.tsx`

- [ ] **Step 1: Imports** — replace the `ConversationNode` import (lines ~75-77) and remove `DraftNode`/`AiNode` imports (lines 68, 70):

```ts
import { ConversationReplyNode } from "@/components/canvas/conversation-reply-node"
```
Delete the `import { DraftNode } ...` (line 68) and `import { AiNode, type AiNodeData } ...` (line 70) lines. (Search for remaining `AiNodeData` uses — see Step 3.)

- [ ] **Step 2: `nodeTypes`** — change the registry (lines 115-124) to drop `draft` and `ai`, and point `conversation` at the new node:

```ts
const nodeTypes = {
  tool: ToolNode,
  "case-info": CaseInfoNode,
  notes: NotesNode,
  macros: MacrosNode,
  queue: QueueNode,
  conversation: ConversationReplyNode,
}
```

- [ ] **Step 3: `buildDefaultLayout`** — replace the conversation push (lines 208-215) so its `data` carries the reply context, and DELETE the `draft` push (lines 225-236) and the `ai` push (lines 253-261):

```ts
      nodes.push({
        id: "conversation",
        type: "conversation",
        position: { x: -480, y: 0 },
        width: 460,
        height: 640,
        data: {
          ...props.conversation,
          conversationId: props.caseInfo.conversationId,
          playbookId: props.playbookId,
          playbookName: props.playbookName,
        },
      })
```

- [ ] **Step 4: `loadLayout`** — in the rehydration map (lines ~284-315): change the `conversation` branch to merge the reply context, and DELETE the `ai` branch (293-303) and the `draft` branch (310-...):

```ts
          if (n.type === "conversation" && props.conversation && props.caseInfo) {
            return {
              ...n,
              data: {
                ...props.conversation,
                conversationId: props.caseInfo.conversationId,
                playbookId: props.playbookId,
                playbookName: props.playbookName,
                copilotTranscript: (n.data as { copilotTranscript?: unknown }).copilotTranscript,
              },
            }
          }
```
Remove the now-unused `AiNodeData` type usage (line ~300) and the `CaseInfoData` import only if it becomes unused (it won't — keep it).

- [ ] **Step 5: Toolbox** — find the "Cards" toolbox dropdown (around lines 700-760) and the `addNode` callback (line ~532, typed `(type: "ai" | "queue")`). Remove the "AI Assistant" and any "Draft" add buttons, and narrow `addNode` to `(type: "queue")` (or remove the `"ai"` arm). Keep the Queue add button.

- [ ] **Step 6: Verify build**

```bash
npm run typecheck && npm run lint
```
Expected: typecheck exit 0; lint shows no NEW errors in touched files (pre-existing warnings in unrelated files are fine).

- [ ] **Step 7: Manual verification (dev server)**

```bash
npm run dev
```
Open a case canvas with a conversation. Verify: ONE card shows thread + composer; `🧠 Copilot` toggles a panel that auto-briefs; `✨ AI ▾` → Generate fills the composer (streams); type something → Improve refines it; paste an image → chip with thumbnail appears; Send posts to Intercom (check the thread/Intercom); after send the composer + chips clear; the standalone Draft and AI cards are gone; the thread refreshes (button + ~15s).

- [ ] **Step 8: Commit**

```bash
git add components/canvas/case-canvas.tsx
git commit -m "feat: canvas uses the unified conversation card; retire draft+ai nodes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Delete retired files + final checks

**Files:**
- Delete: `components/canvas/draft-node.tsx`, `components/canvas/ai-node.tsx`, `components/draft-panel.tsx`, `components/canvas/conversation-node.tsx`

- [ ] **Step 1: Confirm no remaining importers**

```bash
grep -rn "draft-node\|ai-node\|draft-panel\|conversation-node\"" components app | grep -v "conversation-reply-node"
```
Expected: no results (the general-chat FAB `components/ai-chat.tsx` is separate and stays). If the ad-hoc `/canvas` referenced `AiNode`, confirm Q13 (retire everywhere) — remove that usage too.

- [ ] **Step 2: Delete the files**

```bash
git rm components/canvas/draft-node.tsx components/canvas/ai-node.tsx components/draft-panel.tsx components/canvas/conversation-node.tsx
```

- [ ] **Step 3: Full gate**

```bash
npm run typecheck && trap '' TTOU TTIN; npx vitest run < /dev/null && npm run build
```
Expected: typecheck 0; vitest = all pass except the 2 pre-existing macro tests; build exit 0.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove retired draft/ai/conversation node components

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: ADR

**Files:**
- Create: `FanvueSupport/Engineering/Decisions/ADR-0018 Unified conversation card with outbound attachments.md` (vault; not a git repo) + add a line to `Engineering Map.md`.

- [ ] **Step 1: Write the ADR** covering: the merge (one card replaces 3), Copilot-as-panel + auto-brief, AI menu (generate/improve), queue prefill, **the new write surface** — outbound `attachment_files` to the customer (human-gated per ADR-0011; visual guards only, no undo/confirm; the residual fat-finger gap accepted), inbound image paste to the copilot (qwen vision), polling model, and the retirement of the standalone nodes (general chat → FAB). Relate to `[[ADR-0011 Human-gated Intercom writes in the web app]]`, `[[ADR-0017 Vision drafts read customer image attachments]]`.

- [ ] **Step 2: Link it** in `FanvueSupport/Engineering/Engineering Map.md` under "Decisions (ADRs)".

---

## Self-Review

**Spec coverage:** Surface merge (T10/T11) ✓ · Copilot button + auto-brief (T9) ✓ · AI menu Generate/Improve (T1/T2/T7/T8) ✓ · queue prefill + resolve (T5/T7/T10) ✓ · Generate overwrites no-confirm (T7 `streamInto`) ✓ · retire old nodes (T11/T12) ✓ · outbound attachments base64 (T3/T6/T7/T8) ✓ · composer sends all / copilot reads images (T4/T8 vs T6/T7) ✓ · visual guards: thumbnail chips + clear-after-send + `Send · 📎N` badge (T6/T7/T8) ✓ · needs_check double-confirm — **GAP**: not yet wired. Add to T10/T7: when `/api/reply-queue/for-conversation` returns `riskBand === "needs_check"`, require a second Send click (confirm-once) before sending; store a `needsCheck` flag in the composer and gate `send()`. Fix: extend Task 5's return shape with `riskBand`, pass to `useReplyComposer`, and in `send()` require a confirm when `riskBand === "needs_check"` and not yet confirmed. · polling 15s + pause hidden + manual refresh (T10) ✓ · canvas-only (no `/cases/[id]` changes) ✓.

**Placeholder scan:** No "TBD"/"handle errors"/"similar to". Tasks 4, 5, 11 step 5 reference reading an existing file to match a pattern (case-chat tool path, reply-queue-store select, toolbox JSX) rather than quoting code that isn't in this plan's earlier tasks — acceptable since those are existing-code integration points, but the executor MUST read those files.

**Type consistency:** `ComposerAttachment` (T6) used by chips (T6), hook (T7), composer (T8) — consistent. `useReplyComposer` return shape consumed by `ComposerBar` via `ReturnType<...>` — no drift. `attachmentFiles: {name,contentType,data}` consistent across T3 route, T6 helper, T7 send. `images: {name,dataUri}` consistent across T4 case-chat and T9 CopilotPanel. Node `data` shape `ConversationReplyData` (T10) matches what T11 layout/rehydration writes.

**Fix applied above:** added the `needs_check` confirm requirement to the spec coverage; implement it in T5 (return `riskBand`) + T7 (`send()` gate).

---

## Execution Handoff

Plan saved to `docs/plans/2026-06-21-unified-conversation-card.md`. Two execution options:

1. **Subagent-driven (recommended for this size)** — one fresh subagent per task, I review between tasks. Matches how the vision feature shipped (waves of disjoint-file agents + review).
2. **Inline execution** — I implement task-by-task in this session with checkpoints.

Which approach?
