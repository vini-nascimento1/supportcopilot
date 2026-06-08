import "server-only"

const ALLOWED_USERS = ["vinicius.nascimento@fanvue.com"]

export function isGmailTemplateUser(email: string | null): boolean {
  if (!email) return false
  return ALLOWED_USERS.includes(email.toLowerCase())
}
