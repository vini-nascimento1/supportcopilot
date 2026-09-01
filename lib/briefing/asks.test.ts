import { describe, it, expect } from "vitest"

import { asksTheReader, containsPhrase, readsAsQuestion } from "./asks"

describe("readsAsQuestion", () => {
  it("accepts an explicit question mark", () => {
    expect(readsAsQuestion("is the payout still on hold?")).toBe(true)
  })

  it("accepts an interrogative opener without punctuation", () => {
    expect(readsAsQuestion("what happens when KYC returns null")).toBe(true)
  })

  it("looks past a leading @mention", () => {
    expect(readsAsQuestion("<@U0AGENT> how do we handle a chargeback")).toBe(true)
  })

  it("accepts the ask phrases the plan names", () => {
    expect(readsAsQuestion("can you take a look at this one")).toBe(true)
    expect(readsAsQuestion("do we have a macro for this")).toBe(true)
    expect(readsAsQuestion("should we escalate it")).toBe(true)
  })

  it("rejects a plain statement — a false positive burns a model call", () => {
    expect(readsAsQuestion("shipped the fix, thanks for the review")).toBe(false)
    expect(readsAsQuestion("")).toBe(false)
    expect(readsAsQuestion(null)).toBe(false)
    expect(readsAsQuestion(undefined)).toBe(false)
  })
})

describe("containsPhrase", () => {
  it("matches only at a word start, so short tokens stay honest", () => {
    expect(containsPhrase("what's the eta on this", "eta")).toBe(true)
    expect(containsPhrase("the beta build shipped", "eta")).toBe(false)
    expect(containsPhrase("assigned to the design team", "sign")).toBe(false)
    expect(containsPhrase("please sign the addendum", "sign")).toBe(true)
  })

  it("still matches an inflected ending", () => {
    expect(containsPhrase("approved the payout", "approve")).toBe(true)
    expect(containsPhrase("confirmed with payments", "confirm")).toBe(true)
  })
})

describe("asksTheReader", () => {
  it("keeps everything readsAsQuestion already accepted", () => {
    expect(asksTheReader("what's the refund window?")).toBe(true)
    expect(asksTheReader("<@U0AGENT> do we refund tips")).toBe(true)
  })

  it("accepts a request that never asks a question", () => {
    expect(asksTheReader("please take a look at the MassPay thread")).toBe(true)
    expect(asksTheReader("<@U0AGENT> need your call on this one before I reply")).toBe(true)
    expect(asksTheReader("urgent: creator locked out")).toBe(true)
    expect(asksTheReader("pls have a look when you get a chance")).toBe(true)
    expect(asksTheReader("wdyt")).toBe(true)
    expect(asksTheReader("eta on the fix")).toBe(true)
  })

  it("rejects a cc-style mention — the thing that was flooding Needs you now", () => {
    expect(asksTheReader("cc <@U0AGENT> for visibility")).toBe(false)
    expect(asksTheReader("cc @vini for visibility")).toBe(false)
    expect(asksTheReader("looping in <@U0AGENT> so it's on their radar")).toBe(false)
  })

  it("rejects acknowledgements and status posts", () => {
    expect(asksTheReader("thanks!")).toBe(false)
    expect(asksTheReader("done ✅")).toBe(false)
    expect(asksTheReader("deployed the beta build, all green")).toBe(false)
    expect(asksTheReader("")).toBe(false)
    expect(asksTheReader(null)).toBe(false)
  })

  it("does not read a request phrase out of a Slack user id", () => {
    // The markup is stripped first, so "<@UETA...>" cannot smuggle in "eta".
    expect(asksTheReader("<@UETA9021> shipped the report")).toBe(false)
  })
})
