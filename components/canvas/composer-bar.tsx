"use client"

import { useRef, type ChangeEvent, type ClipboardEvent } from "react"
import {
  ChevronDownIcon,
  Loader2Icon,
  PaperclipIcon,
  SendIcon,
  SparklesIcon,
} from "lucide-react"

import { AttachmentChips } from "@/components/canvas/attachment-chips"
import type { useReplyComposer } from "@/components/canvas/use-reply-composer"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Textarea } from "@/components/ui/textarea"
import { ALLOWED_SEND_TYPES } from "@/lib/reply-attachments"

type Composer = ReturnType<typeof useReplyComposer>

export function ComposerBar({ composer }: { composer: Composer }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const {
    text,
    setText,
    attachments,
    addFiles,
    removeAttachment,
    busy,
    needsCheckConfirming,
    generate,
    improve,
    send,
  } = composer
  const attachmentCount = attachments.length
  const aiBusy = busy === "generate" || busy === "improve"

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files).filter((file) =>
      ALLOWED_SEND_TYPES.has(file.type)
    )
    if (files.length === 0) return

    event.preventDefault()
    void addFiles(files)
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files?.length) void addFiles(event.target.files)
    event.target.value = ""
  }

  return (
    <div className="nodrag flex shrink-0 flex-col gap-1 border-t p-2">
      <AttachmentChips attachments={attachments} onRemove={removeAttachment} />
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onPaste={onPaste}
        placeholder="Type a reply... paste images/files to attach"
        className="min-h-16 resize-y rounded-md text-sm"
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={[...ALLOWED_SEND_TYPES].join(",")}
            className="hidden"
            onChange={onFileChange}
          />
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            title="Attach file"
            onClick={() => fileRef.current?.click()}
          >
            <PaperclipIcon />
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={Boolean(busy)}
                className="gap-1 px-2"
              >
                {aiBusy ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <SparklesIcon />
                )}
                AI
                <ChevronDownIcon className="size-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-44 gap-1 p-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => void generate()}
              >
                Generate
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => void improve()}
              >
                Improve
              </Button>
            </PopoverContent>
          </Popover>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={busy === "send" || (!text.trim() && attachmentCount === 0)}
          onClick={() => void send()}
          className="shrink-0"
        >
          {busy === "send" ? (
            <Loader2Icon className="animate-spin" />
          ) : (
            <SendIcon />
          )}
          {busy === "send"
            ? "Sending..."
            : needsCheckConfirming
              ? "Confirm send"
              : "Send"}
          {busy !== "send" && attachmentCount > 0 ? (
            <span className="rounded bg-primary-foreground/20 px-1 text-[10px] leading-4">
              📎{attachmentCount}
            </span>
          ) : null}
        </Button>
      </div>
    </div>
  )
}
