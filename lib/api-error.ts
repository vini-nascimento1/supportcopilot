export async function readApiError(response: Response, fallback?: string): Promise<string> {
  const text = await response.text().catch(() => "")
  if (text) {
    try {
      const json = JSON.parse(text) as { error?: unknown }
      if (typeof json.error === "string" && json.error.trim()) {
        return json.error
      }
    } catch {
      return text
    }
    return text
  }
  return fallback ?? `Request failed (${response.status})`
}
