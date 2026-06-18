import { describe, it, expect } from "vitest"

import {
  accessTokenNeedsRefresh,
  refreshTokenExpired,
  nextTokenColumns,
  ACCESS_TOKEN_SKEW_MS,
} from "./notion-mcp-auth"

const NOW = Date.parse("2026-06-18T12:00:00.000Z")

describe("accessTokenNeedsRefresh", () => {
  it("needs refresh when there is no token", () => {
    expect(accessTokenNeedsRefresh(null, NOW)).toBe(true)
  })

  it("needs refresh when the timestamp is unparseable", () => {
    expect(accessTokenNeedsRefresh("not-a-date", NOW)).toBe(true)
  })

  it("does not need refresh when comfortably in the future", () => {
    const future = new Date(NOW + 30 * 60_000).toISOString() // +30 min
    expect(accessTokenNeedsRefresh(future, NOW)).toBe(false)
  })

  it("needs refresh inside the skew window", () => {
    const soon = new Date(NOW + ACCESS_TOKEN_SKEW_MS - 1_000).toISOString()
    expect(accessTokenNeedsRefresh(soon, NOW)).toBe(true)
  })

  it("needs refresh when already expired", () => {
    const past = new Date(NOW - 1_000).toISOString()
    expect(accessTokenNeedsRefresh(past, NOW)).toBe(true)
  })
})

describe("refreshTokenExpired", () => {
  it("is expired when missing", () => {
    expect(refreshTokenExpired(null, NOW)).toBe(true)
  })

  it("is not expired when in the future", () => {
    const future = new Date(NOW + 10 * 86_400_000).toISOString() // +10 days
    expect(refreshTokenExpired(future, NOW)).toBe(false)
  })

  it("is expired when in the past", () => {
    const past = new Date(NOW - 1_000).toISOString()
    expect(refreshTokenExpired(past, NOW)).toBe(true)
  })
})

describe("nextTokenColumns", () => {
  const res = { access_token: "acc-2", refresh_token: "ref-2", expires_in: 3600 }

  it("stamps the absolute refresh window on initial consent", () => {
    const cols = nextTokenColumns(res, NOW, {
      isInitialConsent: true,
      existingRefreshExpiresAt: null,
    })
    expect(cols.notion_mcp_access_token).toBe("acc-2")
    expect(cols.notion_mcp_refresh_token).toBe("ref-2")
    expect(cols.notion_mcp_token_expires_at).toBe(
      new Date(NOW + 3600 * 1000).toISOString()
    )
    expect(cols.notion_mcp_refresh_expires_at).toBe(
      new Date(NOW + 30 * 86_400_000).toISOString()
    )
  })

  it("keeps the existing refresh window on a refresh (it does not slide)", () => {
    const existing = new Date(NOW + 5 * 86_400_000).toISOString()
    const cols = nextTokenColumns(res, NOW, {
      isInitialConsent: false,
      existingRefreshExpiresAt: existing,
    })
    expect(cols.notion_mcp_refresh_expires_at).toBe(existing)
    // access expiry still advances
    expect(cols.notion_mcp_token_expires_at).toBe(
      new Date(NOW + 3600 * 1000).toISOString()
    )
    // the rotated refresh token is persisted
    expect(cols.notion_mcp_refresh_token).toBe("ref-2")
  })

  it("honours a custom refresh window", () => {
    const cols = nextTokenColumns(res, NOW, {
      isInitialConsent: true,
      existingRefreshExpiresAt: null,
      refreshWindowDays: 7,
    })
    expect(cols.notion_mcp_refresh_expires_at).toBe(
      new Date(NOW + 7 * 86_400_000).toISOString()
    )
  })
})
