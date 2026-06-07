/** Client-safe Slack utilities (no server-only). */

/** Build a permalink to a specific Slack message. */
export function getMessagePermalink(
  workspaceUrl: string,
  channelId: string,
  ts: string
): string {
  if (!ts) return `${workspaceUrl}/archives/${channelId}`
  const tsClean = ts.replace(".", "")
  return `${workspaceUrl}/archives/${channelId}/p${tsClean}`
}
