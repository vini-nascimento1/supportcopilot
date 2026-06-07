export function parseSteps(text: string | null | undefined): string[] {
  if (!text) return []
  const parts = text.split(/\s*\d+\.\s+/).filter(Boolean)
  if (parts.length > 1) return parts.map((s) => s.trim())
  return text
    .split(/\n/)
    .map((s) => s.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
}
