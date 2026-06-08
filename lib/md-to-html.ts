/**
 * Converts a subset of markdown (bold, italic, links, lists, paragraphs)
 * to the simple HTML subset that Intercom conversation replies support.
 *
 * Intercom-supported tags: <strong>, <em>, <a>, <ul>/<ol>/<li>, <p>, <br>
 * Reference: https://community.intercom.com/conversations-9/support-html-for-api-email-conversations-8549
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function processInline(text: string): string {
  let s = escapeHtml(text)

  // Bold (**text**) — must come before italic so ** isn't mistaken for *
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
  // Italic (*text*)
  s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>")
  s = s.replace(/_(.+?)_/g, "<em>$1</em>")
  // Links [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  return s
}

export function mdToHtml(md: string): string {
  const lines = md.split("\n")
  const result: string[] = []
  let inUl = false
  let inOl = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Empty line — close any open list, emit blank
    if (line.trim() === "") {
      if (inUl) {
        result.push("</ul>")
        inUl = false
      }
      if (inOl) {
        result.push("</ol>")
        inOl = false
      }
      continue
    }

    // Bullet list item
    const ulMatch = line.match(/^\s*[-*+]\s+(.*)/)
    if (ulMatch) {
      if (inOl) {
        result.push("</ol>")
        inOl = false
      }
      if (!inUl) {
        result.push("<ul>")
        inUl = true
      }
      result.push(`<li>${processInline(ulMatch[1])}</li>`)
      continue
    }

    // Numbered list item
    const olMatch = line.match(/^\s*\d+\.\s+(.*)/)
    if (olMatch) {
      if (inUl) {
        result.push("</ul>")
        inUl = false
      }
      if (!inOl) {
        result.push("<ol>")
        inOl = true
      }
      result.push(`<li>${processInline(olMatch[1])}</li>`)
      continue
    }

    // Close any open list before a non-list line
    if (inUl) {
      result.push("</ul>")
      inUl = false
    }
    if (inOl) {
      result.push("</ol>")
      inOl = false
    }

    // Regular paragraph
    result.push(`<p>${processInline(line)}</p>`)
  }

  // Close any list left open at end of input
  if (inUl) result.push("</ul>")
  if (inOl) result.push("</ol>")

  return result.join("\n")
}
