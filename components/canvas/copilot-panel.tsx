"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
} from "react"
import {
  ImageIcon,
  Loader2Icon,
  RefreshCwIcon,
  SendIcon,
  XIcon,
} from "lucide-react"

import { MarkdownPreview } from "@/components/markdown-preview"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { fileToAttachment } from "@/lib/reply-attachments"

export type CopilotMessage = { role: "user" | "assistant"; content: string }

type PendingImage = { name: string; dataUri: string }

const AUTO_BRIEF =
  "Give me a tight brief on this case: what it is, the matching playbook, and the exact next steps."

export function CopilotPanel({
  conversationId,
  transcript,
  onTranscript,
}: {
  conversationId: string
  transcript: CopilotMessage[]
  onTranscript: (messages: CopilotMessage[]) => void
}) {
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const listRef = useRef<HTMLDivElement>(null)
  const briefedRef = useRef(false)
  const loadingRef = useRef(false)
  const imageIdRef = useRef(0)
  const transcriptRef = useRef(transcript)

  useEffect(() => {
    transcriptRef.current = transcript
  }, [transcript])

  const scrollToBottom = () => {
    requestAnimationFrame(() =>
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
    )
  }

  const ask = useCallback(
    async (text: string, images?: PendingImage[]) => {
      if (loadingRef.current) return
      const content = text.trim()
      if (!content && !images?.length) return

      setError(null)
      const updated: CopilotMessage[] = [
        ...transcriptRef.current,
        {
          role: "user",
          content:
            content || "What does this image show, in this case's context?",
        },
      ]
      onTranscript(updated)
      transcriptRef.current = updated
      loadingRef.current = true
      setLoading(true)

      try {
        const res = await fetch("/api/ai/case-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: updated, conversationId, images }),
        })
        const payload = await res.json()
        if (!res.ok) {
          setError(payload.error ?? "Something went wrong")
          return
        }
        const next: CopilotMessage[] = [
          ...updated,
          { role: "assistant", content: payload.message },
        ]
        onTranscript(next)
        transcriptRef.current = next
      } catch {
        setError("Network error. Check your connection.")
      } finally {
        loadingRef.current = false
        setLoading(false)
        scrollToBottom()
      }
    },
    [conversationId, onTranscript]
  )

  useEffect(() => {
    if (!briefedRef.current && transcript.length === 0) {
      briefedRef.current = true
      void ask(AUTO_BRIEF)
    }
  }, [ask, transcript.length])

  const onPaste = async (event: ClipboardEvent<HTMLInputElement>) => {
    const images = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith("image/")
    )
    if (images.length === 0) return

    event.preventDefault()
    const encoded = await Promise.all(
      images.map(async (file, index) => {
        const attachment = await fileToAttachment(
          file,
          `ci-${imageIdRef.current++}-${index}`
        )
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
        return {
          name: attachment.name,
          dataUri: `data:${attachment.contentType};base64,${attachment.data}`,
        }
      })
    )
    setPendingImages((current) => [...current, ...encoded])
  }

  const submit = () => {
    if (loading) return
    const text = input.trim()
    if (!text && pendingImages.length === 0) return
    setInput("")
    const images = pendingImages
    setPendingImages([])
    void ask(text, images.length > 0 ? images : undefined)
  }

  return (
    <div className="nodrag flex h-full min-h-0 flex-col overflow-hidden bg-card">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-muted/40 px-2 text-xs font-medium">
        <span>Copilot</span>
        {loading && (
          <Loader2Icon className="size-3 animate-spin text-muted-foreground" />
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="ml-auto"
          title="Refresh insight"
          onClick={() => void ask(AUTO_BRIEF)}
          disabled={loading}
        >
          <RefreshCwIcon className="size-3" />
        </Button>
      </div>

      <div
        ref={listRef}
        className="nowheel flex min-h-0 flex-1 cursor-auto flex-col gap-2 overflow-y-auto p-2 select-text"
      >
        {transcript.map((message, index) =>
          message.role === "user" ? (
            <div
              key={index}
              className="ml-6 self-end rounded-lg bg-primary px-2.5 py-1.5 text-xs text-primary-foreground"
            >
              {message.content}
            </div>
          ) : (
            <div
              key={index}
              className="mr-1 self-start [&_.markdown-preview]:text-xs"
            >
              <MarkdownPreview content={message.content} />
            </div>
          )
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      {pendingImages.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-1 border-t px-2 py-1">
          {pendingImages.map((image, index) => (
            <span
              key={`${image.name}-${index}`}
              className="flex max-w-full items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
            >
              <ImageIcon className="size-3 shrink-0" />
              <span className="truncate">{image.name}</span>
              <button
                type="button"
                className="rounded-sm hover:text-foreground"
                title="Remove image"
                onClick={() =>
                  setPendingImages((current) =>
                    current.filter((_, imageIndex) => imageIndex !== index)
                  )
                }
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex shrink-0 items-center gap-1.5 border-t p-2">
        <Input
          className="h-7 text-xs"
          placeholder="Ask about this case..."
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onPaste={onPaste}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              submit()
            }
          }}
        />
        <Button
          type="button"
          size="icon-sm"
          className="size-7"
          onClick={submit}
          disabled={loading || (!input.trim() && pendingImages.length === 0)}
        >
          <SendIcon className="size-3" />
        </Button>
      </div>
    </div>
  )
}
