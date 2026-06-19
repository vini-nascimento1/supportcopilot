import { describe, it, expect } from "vitest"

import {
  parseProtectedResourceMetadata,
  parseAuthServerMetadata,
  buildRegistrationBody,
  parseRegistrationResponse,
  base64UrlEncode,
  makeCodeVerifier,
  codeChallengeFromDigest,
  buildAuthorizationUrl,
  buildTokenExchangeBody,
  buildRefreshBody,
  parseTokenResponse,
  type NotionOAuthServerConfig,
} from "./notion-mcp-oauth"

const CONFIG: NotionOAuthServerConfig = {
  issuer: "https://mcp.notion.com",
  authorizationEndpoint: "https://mcp.notion.com/authorize",
  tokenEndpoint: "https://mcp.notion.com/token",
  registrationEndpoint: "https://mcp.notion.com/register",
}

describe("parseProtectedResourceMetadata", () => {
  it("returns the first authorization server from the array", () => {
    expect(
      parseProtectedResourceMetadata({
        authorization_servers: ["https://auth.notion.com", "https://other"],
      })
    ).toBe("https://auth.notion.com")
  })

  it("falls back to a singular authorization_server field", () => {
    expect(
      parseProtectedResourceMetadata({ authorization_server: "https://auth.notion.com" })
    ).toBe("https://auth.notion.com")
  })

  it("returns null when malformed", () => {
    expect(parseProtectedResourceMetadata(null)).toBeNull()
    expect(parseProtectedResourceMetadata({})).toBeNull()
    expect(parseProtectedResourceMetadata({ authorization_servers: [] })).toBeNull()
    expect(parseProtectedResourceMetadata({ authorization_servers: [123] })).toBeNull()
  })
})

describe("parseAuthServerMetadata", () => {
  it("parses all four endpoints", () => {
    const cfg = parseAuthServerMetadata(
      {
        issuer: "https://issuer.example",
        authorization_endpoint: "https://a/authorize",
        token_endpoint: "https://a/token",
        registration_endpoint: "https://a/register",
      },
      "https://fallback"
    )
    expect(cfg).toEqual({
      issuer: "https://issuer.example",
      authorizationEndpoint: "https://a/authorize",
      tokenEndpoint: "https://a/token",
      registrationEndpoint: "https://a/register",
    })
  })

  it("uses the passed issuer when the document omits it", () => {
    const cfg = parseAuthServerMetadata(
      {
        authorization_endpoint: "https://a/authorize",
        token_endpoint: "https://a/token",
        registration_endpoint: "https://a/register",
      },
      "https://fallback"
    )
    expect(cfg?.issuer).toBe("https://fallback")
  })

  it("returns null if any endpoint is missing", () => {
    expect(
      parseAuthServerMetadata(
        { authorization_endpoint: "https://a", token_endpoint: "https://t" },
        "https://x"
      )
    ).toBeNull()
    expect(parseAuthServerMetadata(null, "https://x")).toBeNull()
  })
})

describe("buildRegistrationBody", () => {
  it("registers a public PKCE client with both grant types", () => {
    const body = buildRegistrationBody("https://app.example/api/auth/notion/callback")
    expect(body).toMatchObject({
      redirect_uris: ["https://app.example/api/auth/notion/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    })
    expect(typeof body.client_name).toBe("string")
  })
})

describe("parseRegistrationResponse", () => {
  it("captures client_id + endpoints and a secret when present", () => {
    const client = parseRegistrationResponse(
      { client_id: "abc", client_secret: "shh" },
      CONFIG
    )
    expect(client).toEqual({
      client_id: "abc",
      client_secret: "shh",
      token_endpoint: CONFIG.tokenEndpoint,
      authorization_endpoint: CONFIG.authorizationEndpoint,
    })
  })

  it("nulls the secret for a public client", () => {
    const client = parseRegistrationResponse({ client_id: "abc" }, CONFIG)
    expect(client?.client_secret).toBeNull()
  })

  it("returns null without a client_id", () => {
    expect(parseRegistrationResponse({}, CONFIG)).toBeNull()
    expect(parseRegistrationResponse(null, CONFIG)).toBeNull()
  })
})

describe("PKCE helpers", () => {
  it("base64url-encodes without padding or +/ characters", () => {
    // bytes chosen to force + and / in standard base64 (0xfb 0xff 0xfe)
    const out = base64UrlEncode(new Uint8Array([0xfb, 0xff, 0xfe]))
    expect(out).not.toMatch(/[+/=]/)
    expect(out).toBe("-__-")
  })

  it("makeCodeVerifier produces a 43-char string from 32 random bytes", () => {
    const verifier = makeCodeVerifier(new Uint8Array(32).fill(0))
    expect(verifier.length).toBe(43)
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it("codeChallengeFromDigest base64url-encodes the digest", () => {
    const digest = new Uint8Array([0xfb, 0xff, 0xfe]).buffer
    expect(codeChallengeFromDigest(digest)).toBe("-__-")
  })
})

describe("buildAuthorizationUrl", () => {
  it("includes PKCE + state + S256 method", () => {
    const url = new URL(
      buildAuthorizationUrl(CONFIG.authorizationEndpoint, {
        clientId: "cid",
        redirectUri: "https://app.example/cb",
        state: "st",
        codeChallenge: "chal",
      })
    )
    expect(url.origin + url.pathname).toBe("https://mcp.notion.com/authorize")
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("client_id")).toBe("cid")
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example/cb")
    expect(url.searchParams.get("state")).toBe("st")
    expect(url.searchParams.get("code_challenge")).toBe("chal")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
  })

  it("only sets scope when non-empty", () => {
    const url = new URL(
      buildAuthorizationUrl(CONFIG.authorizationEndpoint, {
        clientId: "cid",
        redirectUri: "https://app.example/cb",
        state: "st",
        codeChallenge: "chal",
        scope: "read",
      })
    )
    expect(url.searchParams.get("scope")).toBe("read")
  })
})

describe("buildTokenExchangeBody", () => {
  it("builds a PKCE authorization_code body without a secret", () => {
    const body = buildTokenExchangeBody({
      clientId: "cid",
      code: "abc",
      redirectUri: "https://app/cb",
      codeVerifier: "ver",
    })
    expect(body.get("grant_type")).toBe("authorization_code")
    expect(body.get("code")).toBe("abc")
    expect(body.get("redirect_uri")).toBe("https://app/cb")
    expect(body.get("client_id")).toBe("cid")
    expect(body.get("code_verifier")).toBe("ver")
    expect(body.get("client_secret")).toBeNull()
  })

  it("includes the secret for a confidential client", () => {
    const body = buildTokenExchangeBody({
      clientId: "cid",
      code: "abc",
      redirectUri: "https://app/cb",
      codeVerifier: "ver",
      clientSecret: "shh",
    })
    expect(body.get("client_secret")).toBe("shh")
  })
})

describe("buildRefreshBody", () => {
  it("builds a refresh_token grant body", () => {
    const body = buildRefreshBody({ clientId: "cid", refreshToken: "ref" })
    expect(body.get("grant_type")).toBe("refresh_token")
    expect(body.get("refresh_token")).toBe("ref")
    expect(body.get("client_id")).toBe("cid")
  })
})

describe("parseTokenResponse", () => {
  it("parses a successful token response", () => {
    const res = parseTokenResponse({
      access_token: "acc",
      refresh_token: "ref",
      expires_in: 3600,
    })
    expect(res).toEqual({ ok: true, access_token: "acc", refresh_token: "ref", expires_in: 3600 })
  })

  it("defaults expires_in to 3600 when absent", () => {
    const res = parseTokenResponse({ access_token: "acc", refresh_token: "ref" })
    expect(res).toEqual({ ok: true, access_token: "acc", refresh_token: "ref", expires_in: 3600 })
  })

  it("surfaces invalid_grant verbatim as terminal", () => {
    expect(parseTokenResponse({ error: "invalid_grant" })).toEqual({
      ok: false,
      error: "invalid_grant",
    })
  })

  it("errors on missing tokens or malformed body", () => {
    expect(parseTokenResponse({ access_token: "acc" })).toEqual({
      ok: false,
      error: "no_refresh_token",
    })
    expect(parseTokenResponse({ refresh_token: "ref" })).toEqual({
      ok: false,
      error: "no_access_token",
    })
    expect(parseTokenResponse(null)).toEqual({ ok: false, error: "malformed_response" })
  })
})
