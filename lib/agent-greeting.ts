// Dependency-free so client components (Settings > Profile, the Home agent-name
// gate) can import it for a live preview without dragging in lib/draft-ai.ts,
// which transitively imports "server-only".
//
// The mandatory opening line for a reply where THIS agent has not spoken in the
// thread yet (feedback: Vincenzo greeting rule). The reply-queue pipeline injects
// this deterministically AFTER generation rather than trusting the model to
// reproduce it, so the exact wording AND the agent's name are guaranteed on every
// draft. When there is no real agent name (generic fallback), the "I'm X" clause
// is dropped rather than reading "I'm the support team".
export const GENERIC_AGENT_NAME = "the support team"

export function buildAgentGreeting(agentName: string | null | undefined): string {
  const name = agentName && agentName !== GENERIC_AGENT_NAME ? agentName.trim() : ""
  return name
    ? `Hey! 👋 Thanks for reaching out to Fanvue Support, I'm ${name}. I'll do my best to assist you today! 😊`
    : `Hey! 👋 Thanks for reaching out to Fanvue Support. I'll do my best to assist you today! 😊`
}
