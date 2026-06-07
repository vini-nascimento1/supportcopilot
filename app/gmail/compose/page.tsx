"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeftIcon, SendIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"

export default function ComposePage() {
  const router = useRouter()
  const [to, setTo] = useState("")
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle")
  const [error, setError] = useState("")

  async function handleSend() {
    if (!to.trim() || !subject.trim() || !body.trim()) return
    setStatus("sending")
    setError("")

    try {
      const res = await fetch("/api/gmail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: to.trim(), subject: subject.trim(), body: body.trim() }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) {
        setStatus("error")
        setError(data.error ?? "Send failed")
        return
      }
      setStatus("sent")
      setTimeout(() => router.push("/gmail"), 1500)
    } catch (e) {
      setStatus("error")
      setError(e instanceof Error ? e.message : "Network error")
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur lg:px-6">
        <Link
          href="/gmail"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
        </Link>
        <h1 className="text-sm font-semibold">Compose</h1>
      </header>

      <main className="mx-auto flex max-w-2xl flex-col gap-4 p-4 lg:p-6">
        {status === "sent" ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <span className="text-4xl">✓</span>
            <p className="font-medium">Message sent!</p>
            <p className="text-sm text-muted-foreground">Redirecting to inbox…</p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="to">To</Label>
              <Input
                id="to"
                type="email"
                placeholder="recipient@example.com"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                disabled={status === "sending"}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="subject">Subject</Label>
              <Input
                id="subject"
                placeholder="Subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={status === "sending"}
              />
            </div>

            <Separator />

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="body">Message</Label>
              <Textarea
                id="body"
                placeholder="Write your message…"
                className="min-h-56 resize-y"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={status === "sending"}
              />
            </div>

            {status === "error" && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <div className="flex justify-end">
              <Button
                onClick={handleSend}
                disabled={!to.trim() || !subject.trim() || !body.trim() || status === "sending"}
              >
                <SendIcon className="size-4" />
                {status === "sending" ? "Sending…" : "Send"}
              </Button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
