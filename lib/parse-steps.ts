export function parseSteps(text: string | null | undefined): string[] {
  if (!text) return []

  // Only split on numbered lists that start at the beginning of a line
  // (not on arbitrary numbers like "version 2.0" mid-sentence)
  const numberedItems = text.split(/\n\s*\d+\.\s+/).filter(Boolean)

  if (numberedItems.length > 1) {
    // Re-attach the first item's leading number if it was stripped
    const first = numberedItems[0]!.replace(/^\s*\d+\.\s+/, "").trim()
    const rest = numberedItems.slice(1).map((s) => s.trim())
    return [first, ...rest]
  }

  // Fallback: split on bullet lines
  return text
    .split(/\n/)
    .map((s) => s.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
}
