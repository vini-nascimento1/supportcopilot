import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/gmail-client", () => ({ getInboxThreads: vi.fn() }))

import { getInboxThreads, type GmailThreadSummary } from "@/lib/gmail-client"
import { classifyEmail, collectGmailItems, isPartnerSender, toEmailItem } from "./gmail"

const NOW = Date.parse("2026-09-01T12:00:00.000Z")

const thread = (over: Partial<GmailThreadSummary> = {}): GmailThreadSummary => ({
  id: "thread-1",
  snippet: "Here is the weekly settlement report for your records.",
  subject: "Weekly settlement report",
  from: "reports@masspay.io",
  fromName: "MassPay Reports",
  date: new Date(NOW - 90 * 60_000).toISOString(),
  isUnread: true,
  messageCount: 1,
  ...over,
})

describe("classifyEmail", () => {
  it("treats the payout/identity partners as action by default", () => {
    expect(isPartnerSender("reports@masspay.io")).toBe(true)
    expect(classifyEmail(thread())).toBe("email_action")
  })

  it("treats a direct question as an action", () => {
    expect(
      classifyEmail({
        from: "colleague@fanvue.com",
        subject: "Quick one",
        snippet: "Are we still refunding tips under ground D?",
      })
    ).toBe("email_action")
  })

  it("treats an ask phrase as an action", () => {
    expect(
      classifyEmail({
        from: "colleague@fanvue.com",
        subject: "Handover",
        snippet: "Please confirm the handover list by EOD.",
      })
    ).toBe("email_action")
  })

  it("leaves a plain announcement as FYI", () => {
    expect(
      classifyEmail({
        from: "news@example.com",
        subject: "Product changelog",
        snippet: "New releases shipped this week.",
      })
    ).toBe("email_fyi")
  })
})

describe("toEmailItem", () => {
  it("normalizes an action email into a summary-only item", () => {
    const item = toEmailItem(thread(), NOW)

    expect(item).toMatchObject({
      id: "gmail:thread-1",
      source: "gmail",
      kind: "email_action",
      // An email is a "today" job — no customer clock is running on it.
      urgency: "today",
      whenLabel: "1h 30m ago",
      deepLink: "https://mail.google.com/mail/u/0/#inbox/thread-1",
      externalId: "thread-1",
    })
    expect(item.context).toBe(
      "From MassPay · Here is the weekly settlement report for your records."
    )
    // v1 proposes no reply for email: summary only, built from subject + snippet.
    expect(item.prepared?.kind).toBe("summary")
  })

  it("puts an FYI in the calm band", () => {
    const item = toEmailItem(
      thread({ from: "news@example.com", fromName: "Example News", subject: "Changelog", snippet: "Shipped." }),
      NOW
    )
    expect(item.kind).toBe("email_fyi")
    expect(item.urgency).toBe("later")
  })

  it("keeps email addresses out of the title and context", () => {
    const item = toEmailItem(
      thread({ subject: "Re: ada.lovelace@example.com asked about payouts", fromName: "" }),
      NOW
    )
    expect(item.title).not.toContain("@")
    expect(item.title).toContain("[email]")
  })
})

describe("collectGmailItems", () => {
  beforeEach(() => vi.mocked(getInboxThreads).mockReset())

  it("reports not_connected without a Google token", async () => {
    const result = await collectGmailItems({
      googleToken: null,
      email: "a@fanvue.com",
      sinceMs: NOW - 3_600_000,
      nowMs: NOW,
    })
    expect(result.status).toEqual({ source: "gmail", state: "not_connected" })
    expect(getInboxThreads).not.toHaveBeenCalled()
  })

  it("queries only unread mail inside the window and keeps unread threads", async () => {
    vi.mocked(getInboxThreads).mockResolvedValue({
      connected: true,
      threads: [thread(), thread({ id: "read", isUnread: false })],
      nextPageToken: null,
      resultSizeEstimate: 2,
    })

    const sinceMs = NOW - 3_600_000
    const result = await collectGmailItems({
      googleToken: "tok",
      email: "a@fanvue.com",
      sinceMs,
      nowMs: NOW,
    })

    expect(vi.mocked(getInboxThreads).mock.calls[0][3]).toBe(
      `in:inbox is:unread after:${Math.floor(sinceMs / 1000)}`
    )
    expect(result.items.map((i) => i.externalId)).toEqual(["thread-1"])
    expect(result.status).toEqual({ source: "gmail", state: "ok", count: 1 })
  })
})
