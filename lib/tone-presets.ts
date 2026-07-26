// Preset reply tones an agent can pick in Settings — each shows the SAME sample
// customer line rewritten in that tone, so the choice is a real comparison, not
// an abstract label. "Custom" (handled separately) lets an agent write their own
// instead of picking a preset.

export type TonePresetId = "professional" | "warm" | "human"

export type TonePreset = {
  id: TonePresetId
  label: string
  description: string
  // Shown in Settings under the label, for a side-by-side compare.
  examplePreview: string
  // The actual text injected into the drafting system prompt.
  instruction: string
}

// Same customer line rewritten by each preset, so switching between them in the
// Settings UI is a like-for-like comparison.
export const TONE_SAMPLE_MESSAGE = "Why is my payout still pending? This is taking forever."

export const TONE_PRESETS: TonePreset[] = [
  {
    id: "professional",
    label: "Professional",
    description: "Courteous, efficient, and clear — polished without being cold.",
    examplePreview:
      "Thanks for your patience. Your payout is currently processing and should complete within the standard settlement window. I'll keep an eye on it and update you as soon as it clears.",
    instruction:
      "Tone: Professional. Courteous, efficient, and clear. Keep language polished and businesslike while still warm enough to feel human — avoid stiff corporate phrasing, jargon, or cold detachment.",
  },
  {
    id: "warm",
    label: "Warm",
    description: "Friendly and empathetic, a bit more personal warmth up front.",
    examplePreview:
      "I totally get why the wait feels frustrating! Your payout's still moving through processing, and it should land within the usual window. I'll keep watching it for you and let you know the second it's through 😊",
    instruction:
      "Tone: Warm. Friendly and empathetic — acknowledge how the customer feels before answering, use a warmer and more personal register, and light positivity (an occasional emoji is fine) without becoming unprofessional.",
  },
  {
    id: "human",
    label: "Human",
    description: "Reads like a real person typing, not an AI — plain and explanatory.",
    examplePreview:
      "I hear you, waiting on money is never fun. Right now your payout's still processing, which is normal, and it should clear within the usual window. I'll keep an eye on it and come back to you the moment it's done.",
    instruction:
      "Tone: Human. Write exactly like a real person typing to another person, not an AI assistant. Avoid em dashes and other stock AI phrasing or sentence patterns. Be explanatory but not excessive — no padding, no restating the same point twice, no corporate filler.",
  },
]

const MAX_CUSTOM_TONE_CHARS = 500

/**
 * Resolve the stored preset/custom choice into the instruction text to inject
 * into the drafting prompt. Returns null when there's nothing to inject (no
 * preset chosen) — callers fall back to the existing generic warmth rule.
 */
export function toneInstructionFor(
  presetId: string | null | undefined,
  customText: string | null | undefined
): string | null {
  if (presetId === "custom") {
    const trimmed = customText?.trim()
    if (!trimmed) return null
    return `Tone: Custom (agent-defined). ${trimmed.slice(0, MAX_CUSTOM_TONE_CHARS)}`
  }
  const preset = TONE_PRESETS.find((p) => p.id === presetId)
  return preset?.instruction ?? null
}
