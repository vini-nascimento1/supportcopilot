"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { CheckIcon, MessageSquareTextIcon } from "lucide-react"
import { cn } from "@/lib/utils"

type TonePreset = {
  id: string
  label: string
  description: string
  examplePreview: string
  instruction: string
}

type ToneStatus = {
  tonePreset: string | null
  toneCustom: string | null
  presets: TonePreset[]
  sampleMessage: string
}

const MAX_CUSTOM_CHARS = 500

// Lets an agent pick how their AI-drafted replies should sound. Each preset
// shows the SAME sample customer line rewritten in that tone, so choosing one
// is a real comparison instead of a guess from a label. "Custom" reveals a
// free-text box for a fully personal description instead.
export function ReplyToneSettings() {
  const [status, setStatus] = useState<ToneStatus | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [customText, setCustomText] = useState("")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const res = await fetch("/api/agent/tone")
      if (!res.ok) return
      const data = (await res.json()) as ToneStatus
      setStatus(data)
      setSelected(data.tonePreset)
      setCustomText(data.toneCustom ?? "")
    } catch {
      // best-effort
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
      const res = await fetch("/api/agent/tone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tonePreset: selected,
          toneCustom: selected === "custom" ? customText : undefined,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? `Save failed (${res.status})`)
        return
      }
      setSaved(true)
      await load()
    } catch {
      setError("Save failed — please try again.")
    } finally {
      setSaving(false)
    }
  }

  const presets = status?.presets ?? []
  const hasChanges =
    selected !== (status?.tonePreset ?? null) ||
    (selected === "custom" && customText !== (status?.toneCustom ?? ""))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquareTextIcon className="size-4 text-muted-foreground" />
          Reply tone
        </CardTitle>
        <CardDescription>
          Pick how your AI-drafted replies should sound. Applies to every draft generated for you —
          the same sample line below shows how each option would answer it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {status && (
          <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Sample customer message: <span className="italic">&ldquo;{status.sampleMessage}&rdquo;</span>
          </p>
        )}

        <div className="flex flex-col gap-2">
          {presets.map((preset) => {
            const isSelected = selected === preset.id
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  setSelected(preset.id)
                  setSaved(false)
                }}
                className={cn(
                  "flex flex-col gap-1.5 rounded-md border px-3 py-2.5 text-left transition-colors",
                  isSelected ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {isSelected && <CheckIcon className="size-3.5 text-primary" />}
                    {preset.label}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{preset.description}</p>
                <p className="rounded bg-muted/50 px-2 py-1.5 text-xs italic text-muted-foreground">
                  &ldquo;{preset.examplePreview}&rdquo;
                </p>
              </button>
            )
          })}

          <button
            type="button"
            onClick={() => {
              setSelected("custom")
              setSaved(false)
            }}
            className={cn(
              "flex flex-col gap-1.5 rounded-md border px-3 py-2.5 text-left transition-colors",
              selected === "custom" ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40"
            )}
          >
            <span className="flex items-center gap-1.5 text-sm font-medium">
              {selected === "custom" && <CheckIcon className="size-3.5 text-primary" />}
              Custom
            </span>
            <p className="text-xs text-muted-foreground">
              Write your own description of how you want to sound — no preset, no preview.
            </p>
          </button>
        </div>

        {selected === "custom" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tone-custom">Your tone, in your own words</Label>
            <Textarea
              id="tone-custom"
              value={customText}
              onChange={(e) => {
                setCustomText(e.target.value)
                setSaved(false)
              }}
              maxLength={MAX_CUSTOM_CHARS}
              rows={3}
              placeholder="e.g. Personal — treat the customer the way I'd like to be treated, like a human talking to them, not a robot. Avoid em dashes. Explanatory but not excessive."
            />
            <p className="text-right text-xs text-muted-foreground">
              {customText.length}/{MAX_CUSTOM_CHARS}
            </p>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex items-center gap-3">
          <Button type="button" size="sm" onClick={() => void save()} disabled={saving || !hasChanges}>
            {saving ? "Saving…" : "Save"}
          </Button>
          {saved && <span className="text-xs text-green-600">Saved!</span>}
        </div>
      </CardContent>
    </Card>
  )
}
