export const GMAIL_FILTERS = {
  primary: { label: "Primary", query: "in:inbox category:primary" },
  all: { label: "All mail", query: "in:inbox" },
  unread: { label: "Unread", query: "is:unread in:inbox" },
  starred: { label: "Starred", query: "is:starred in:inbox" },
  spam: { label: "Spam", query: "in:spam" },
  trash: { label: "Trash", query: "in:trash" },
} as const

export type GmailFilterKey = keyof typeof GMAIL_FILTERS

export function getFilterQuery(key: string): string {
  return GMAIL_FILTERS[key as GmailFilterKey]?.query ?? GMAIL_FILTERS.primary.query
}
