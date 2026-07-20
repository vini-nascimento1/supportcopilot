"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { CheckCircle2Icon, InfoIcon, KeyRoundIcon, PauseCircleIcon } from "lucide-react"
import { cn } from "@/lib/utils"

type Status = {
  hasPersonalKey: boolean
  enabled: boolean
  baseUrl: string | null
  model: string | null
  defaults: { baseUrl: string; model: string }
  cryptoAvailable: boolean
}

// Lets an agent bring their own OpenAI-compatible API key so their drafting runs
// on their own quota instead of the shared, rate-limited app key. The key is
// entered here (never in chat), stored encrypted server-side, and never shown
// back — this form only reports whether one is set.
export function PersonalAiKeySettings() {
  const [status, setStatus] = useState<Status | null>(null)
  const [apiKey, setApiKey] = useState("")
  const [model, setModel] = useState("")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const res = await fetch("/api/agent/provider")
      if (!res.ok) return
      const data = (await res.json()) as Status
      setStatus(data)
      setModel(data.model ?? "")
    } catch {
      // best-effort; leave the card in its default state
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function save() {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const res = await fetch("/api/agent/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey.trim() || undefined,
          model: model.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? `Save failed (${res.status})`)
        return
      }
      setApiKey("")
      setSaved(true)
      await load()
    } catch {
      setError("Save failed — please try again.")
    } finally {
      setSaving(false)
    }
  }

  async function toggleEnabled(next: boolean) {
    setError(null)
    // Optimistic — reflect the flip immediately, reconcile on reload.
    setStatus((prev) => (prev ? { ...prev, enabled: next } : prev))
    try {
      const res = await fetch("/api/agent/provider", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      })
      if (!res.ok) {
        setError(`Couldn't update (${res.status})`)
      }
    } catch {
      setError("Couldn't update — please try again.")
    } finally {
      await load()
    }
  }

  async function clearKey() {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const res = await fetch("/api/agent/provider", { method: "DELETE" })
      if (!res.ok) {
        setError(`Couldn't remove the key (${res.status})`)
        return
      }
      setApiKey("")
      setModel("")
      await load()
    } catch {
      setError("Couldn't remove the key — please try again.")
    } finally {
      setSaving(false)
    }
  }

  const connected = status?.hasPersonalKey ?? false
  const enabled = status?.enabled ?? true
  const active = connected && enabled
  const defaultModel = status?.defaults.model ?? "gpt-5-nano"

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Personal AI key</CardTitle>
            <CardDescription>
              Use your own OpenAI key for drafting, on your own quota — lifts the shared rate limit.
            </CardDescription>
          </div>
          {active ? (
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2Icon className="size-3 text-green-500" />
              Active
            </Badge>
          ) : connected ? (
            <Badge variant="outline" className="gap-1">
              <PauseCircleIcon className="size-3 text-amber-500" />
              Paused
            </Badge>
          ) : (
            <Badge variant="outline">Using shared key</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {status && !status.cryptoAvailable && (
          <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            <InfoIcon className="size-4 shrink-0" />
            Key encryption isn&apos;t configured on the server yet — ask your admin to set{" "}
            <code className="font-mono text-xs">PROVIDER_ENCRYPTION_KEY</code>.
          </div>
        )}

        {connected && (
          <div className="flex items-start justify-between gap-4 rounded-md border bg-muted/30 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">Use my personal key</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {enabled
                  ? "On — your drafts run on your own key."
                  : "Paused — your key is kept, but drafts use the app's shared key."}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label="Use my personal AI key"
              onClick={() => void toggleEnabled(!enabled)}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                enabled ? "bg-primary" : "bg-input"
              )}
            >
              <span
                className={cn(
                  "inline-block size-5 transform rounded-full bg-background shadow transition-transform",
                  enabled ? "translate-x-[1.375rem]" : "translate-x-0.5"
                )}
              />
            </button>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="personal-ai-key">OpenAI API key</Label>
          <Input
            id="personal-ai-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value)
              setSaved(false)
            }}
            placeholder={connected ? "•••••••••• (set — enter a new key to replace)" : "sk-..."}
            disabled={status ? !status.cryptoAvailable : false}
          />
          <p className="text-xs text-muted-foreground">
            Stored encrypted, never shown again, never sent to your browser. Enter it here — never paste keys into chat.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="personal-ai-model">Model</Label>
          <Input
            id="personal-ai-model"
            value={model}
            onChange={(e) => {
              setModel(e.target.value)
              setSaved(false)
            }}
            placeholder={defaultModel}
          />
          <p className="text-xs text-muted-foreground">
            Multimodal model for both text and images. Defaults to{" "}
            <span className="font-medium">{defaultModel}</span> if left blank.
          </p>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="sm"
            onClick={() => void save()}
            disabled={saving || (status ? !status.cryptoAvailable : false)}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
          {connected && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => void clearKey()}
              disabled={saving}
            >
              <KeyRoundIcon className="size-3.5" />
              Remove key
            </Button>
          )}
          {saved && <span className="text-xs text-green-600">Saved!</span>}
        </div>
      </CardContent>
    </Card>
  )
}
