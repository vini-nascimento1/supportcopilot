/** Max files Intercom accepts per reply is 10; we cap a little lower for safety. */
export const MAX_OUTBOUND_FILES = 8

export type OutboundFile = { name: string; contentType: string; data: string }

type IntercomReplyPayload = {
  type: "admin"
  message_type: "comment"
  admin_id: string
  body: string
  attachment_files?: { content_type: string; name: string; data: string }[]
}

export function buildIntercomReplyPayload(input: {
  adminId: string
  htmlBody: string
  attachmentFiles?: OutboundFile[]
}): IntercomReplyPayload {
  const payload: IntercomReplyPayload = {
    type: "admin",
    message_type: "comment",
    admin_id: input.adminId,
    body: input.htmlBody,
  }
  const files = (input.attachmentFiles ?? []).slice(0, MAX_OUTBOUND_FILES)
  if (files.length > 0) {
    payload.attachment_files = files.map((f) => ({
      content_type: f.contentType,
      name: f.name,
      data: f.data,
    }))
  }
  return payload
}
