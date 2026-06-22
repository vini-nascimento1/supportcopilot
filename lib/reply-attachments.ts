export const MAX_OUTBOUND_FILES = 8
export const MAX_OUTBOUND_BYTES = 10 * 1024 * 1024

export const ALLOWED_SEND_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
])

export function isImageType(ct: string): boolean {
  return ct.startsWith("image/")
}

export type ComposerAttachment = {
  id: string
  name: string
  contentType: string
  /** raw base64 (no data: prefix) - what Intercom attachment_files.data wants */
  data: string
  /** object URL for the thumbnail (images only); caller revokes on remove */
  previewUrl: string | null
  tooLarge: boolean
}

/** Read a File into a ComposerAttachment (base64 + preview). Browser-only. */
export async function fileToAttachment(file: File, id: string): Promise<ComposerAttachment> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  const data = btoa(binary)
  const contentType = file.type || "application/octet-stream"
  return {
    id,
    name: file.name || "attachment",
    contentType,
    data,
    previewUrl: isImageType(contentType) ? URL.createObjectURL(file) : null,
    tooLarge: file.size > MAX_OUTBOUND_BYTES,
  }
}
