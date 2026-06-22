"use client"

import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"

import {
  fileToAttachment,
  MAX_OUTBOUND_FILES,
  type ComposerAttachment,
} from "@/lib/reply-attachments"

type GenMode = "generate" | "improve"

export function useReplyComposer(opts: {
  conversationId: string
  playbookId?: string
  suggestionId?: string | null
  riskBand?: string | null
  onSent?: () => void
}) {
  const { conversationId, playbookId, suggestionId, riskBand, onSent } = opts
  const [text, setText] = useState("")
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const [busy, setBusy] = useState<null | GenMode | "send">(null)
  const [needsCheckConfirming, setNeedsCheckConfirming] = useState(false)
  const dirtyRef = useRef(false)
  const idRef = useRef(0)

  const resetSendConfirmation = useCallback(() => {
    setNeedsCheckConfirming(false)
  }, [])

  const setTextManual = useCallback(
    (value: string) => {
      dirtyRef.current = true
      resetSendConfirmation()
      setText(value)
    },
    [resetSendConfirmation]
  )

  const prefill = useCallback(
    (body: string) => {
      dirtyRef.current = false
      resetSendConfirmation()
      setText(body)
    },
    [resetSendConfirmation]
  )

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const next: ComposerAttachment[] = []
      for (const file of Array.from(files)) {
        next.push(await fileToAttachment(file, `att-${idRef.current++}`))
      }
      if (next.length === 0) return
      resetSendConfirmation()
      setAttachments((current) => {
        const available = Math.max(0, MAX_OUTBOUND_FILES - current.length)
        if (next.length > available) {
          toast.warning(`Only ${MAX_OUTBOUND_FILES} files can be attached.`)
        }
        const accepted = next.slice(0, available)
        next.slice(available).forEach((attachment) => {
          if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
        })
        return [...current, ...accepted]
      })
    },
    [resetSendConfirmation]
  )

  const removeAttachment = useCallback(
    (id: string) => {
      resetSendConfirmation()
      setAttachments((current) => {
        const hit = current.find((attachment) => attachment.id === id)
        if (hit?.previewUrl) URL.revokeObjectURL(hit.previewUrl)
        return current.filter((attachment) => attachment.id !== id)
      })
    },
    [resetSendConfirmation]
  )

  const clearAttachments = useCallback(() => {
    resetSendConfirmation()
    setAttachments((current) => {
      current.forEach((attachment) => {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
      })
      return []
    })
  }, [resetSendConfirmation])

  const streamInto = useCallback(
    async (mode: GenMode) => {
      setBusy(mode)
      try {
        const res = await fetch("/api/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            ...(playbookId ? { playbookId } : {}),
            ...(mode === "improve"
              ? { mode: "improve", currentDraft: text }
              : {}),
          }),
        })

        if (!res.ok || !res.body) {
          toast.error(
            (await res.text().catch(() => "")) ||
              `Request failed (${res.status})`
          )
          return
        }

        dirtyRef.current = false
        resetSendConfirmation()
        setText("")

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let acc = ""
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          acc += decoder.decode(value, { stream: true })
          setText(acc)
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Network error")
      } finally {
        setBusy(null)
      }
    },
    [conversationId, playbookId, resetSendConfirmation, text]
  )

  const generate = useCallback(() => streamInto("generate"), [streamInto])

  const improve = useCallback(() => {
    if (!text.trim()) {
      toast.error("Nothing to improve yet")
      return
    }
    return streamInto("improve")
  }, [streamInto, text])

  const send = useCallback(async () => {
    if (busy) return
    const oversized = attachments.find((attachment) => attachment.tooLarge)
    if (oversized) {
      toast.error(`"${oversized.name}" is too large (max 10MB)`)
      return
    }
    if (!text.trim() && attachments.length === 0) return
    if (riskBand === "needs_check" && !needsCheckConfirming) {
      setNeedsCheckConfirming(true)
      toast.warning("Needs check: click Send again to confirm.")
      return
    }

    setBusy("send")
    try {
      const res = await fetch("/api/draft/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          body: text,
          attachmentFiles: attachments.map((attachment) => ({
            name: attachment.name,
            contentType: attachment.contentType,
            data: attachment.data,
          })),
        }),
      })

      if (!res.ok) {
        toast.error(
          (await res.text().catch(() => "")) || `Failed to send (${res.status})`
        )
        return
      }

      if (suggestionId) {
        await fetch("/api/reply-queue/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            suggestionId,
            action: dirtyRef.current ? "edit" : "approve",
            bodyChanged: dirtyRef.current,
          }),
        }).catch(() => {})
      }

      toast.success("Sent to Intercom")
      dirtyRef.current = false
      setText("")
      clearAttachments()
      resetSendConfirmation()
      onSent?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Network error")
    } finally {
      setBusy(null)
    }
  }, [
    attachments,
    busy,
    clearAttachments,
    conversationId,
    needsCheckConfirming,
    onSent,
    resetSendConfirmation,
    riskBand,
    suggestionId,
    text,
  ])

  return {
    text,
    setText: setTextManual,
    prefill,
    attachments,
    addFiles,
    removeAttachment,
    clearAttachments,
    busy,
    needsCheckConfirming,
    generate,
    improve,
    send,
  }
}
