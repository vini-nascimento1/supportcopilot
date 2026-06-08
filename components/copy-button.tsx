"use client"

import { useState } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

interface Props {
  text: string
  /** Optional HTML version. When provided, copies as text/html so pasting
   *  into Intercom renders formatting (bold, lists, links) seamlessly. */
  htmlText?: string
}

export function CopyButton({ text, htmlText }: Props) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    if (htmlText) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([htmlText], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ])
    } else {
      await navigator.clipboard.writeText(text)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button variant="outline" size="sm" onClick={copy} className="shrink-0">
      {copied ? (
        <CheckIcon className="size-3.5 text-green-600" />
      ) : (
        <CopyIcon className="size-3.5" />
      )}
      {copied ? "Copied" : "Copy"}
    </Button>
  )
}
