import { NextRequest, NextResponse } from "next/server"
import { getAgentTokens } from "@/lib/auth"
import { getAttachmentData } from "@/lib/gmail-client"

export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ messageId: string; attachmentId: string }> }
) {
  const { messageId, attachmentId } = await params
  const tokens = await getAgentTokens()
  if (!tokens.googleToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const result = await getAttachmentData(tokens.googleToken, tokens.email, messageId, attachmentId)
  if (!result) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 })
  }

  // Decode base64url to raw bytes
  const base64 = result.data.replace(/-/g, "+").replace(/_/g, "/")
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=")
  const raw = Buffer.from(padded, "base64")

  // Use filename from query param if provided
  const filename = request.nextUrl.searchParams.get("filename") ?? "attachment"
  const encodedFilename = encodeURIComponent(filename)

  return new NextResponse(raw, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(raw.length),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodedFilename}`,
    },
  })
}
