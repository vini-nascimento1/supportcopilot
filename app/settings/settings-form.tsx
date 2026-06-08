"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { InfoIcon } from "lucide-react"

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

type AgentData = {
  name: string | null
  timezone: string | null
  working_days: number[] | null
}

export function SettingsForm({
  email,
  agent,
}: {
  email: string
  agent: {
    name: string | null
    timezone: string | null
    working_days: number[] | null
  } | null
}) {
  const [name, setName] = useState(agent?.name ?? "")
  const [timezone, setTimezone] = useState(agent?.timezone ?? "Europe/London")
  const [workingDays, setWorkingDays] = useState<number[]>(agent?.working_days ?? [1, 2, 3, 4, 5])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const origName = agent?.name ?? ""
  const origTz = agent?.timezone ?? "Europe/London"
  const origWd = agent?.working_days ?? [1, 2, 3, 4, 5]

  const hasChanges =
    name !== origName ||
    timezone !== origTz ||
    workingDays.join(",") !== origWd.join(",")

  function toggleDay(d: number) {
    setWorkingDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))
    setSaved(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)

    const days = workingDays.length > 0 ? workingDays : null

    try {
      const res = await fetch("/api/settings/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name: name.trim() || null, timezone: timezone.trim() || null, workingDays: days }),
      })

      if (!res.ok) {
        const err = await res.json()
        console.error("Save failed:", err)
        return
      }

      setSaved(true)
      // Reload page so server-rendered sections (integrations, etc.) get fresh data
      window.location.reload()
    } catch (err) {
      console.error("Save failed:", err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      {hasChanges && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          <InfoIcon className="size-4 shrink-0" />
          You have unsaved changes — click <strong>Save</strong> to apply them.
        </div>
      )}

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
          <CardDescription>Your name, display preferences, and working days.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email-display">Email</Label>
            <Input
              id="email-display"
              value={email ?? "Not signed in"}
              disabled
              className="bg-muted/50 text-muted-foreground"
            />
            <p className="text-xs text-muted-foreground">
              From your Google Workspace account — read-only.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Display name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => { setName(e.target.value); setSaved(false) }}
              placeholder="Your name"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="timezone">Timezone</Label>
            <Input
              id="timezone"
              value={timezone}
              onChange={(e) => { setTimezone(e.target.value); setSaved(false) }}
              placeholder="e.g. Europe/London"
            />
            <p className="text-xs text-muted-foreground">
              IANA timezone name. Used for shift greetings on the dashboard.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Working days</Label>
            <p className="text-xs text-muted-foreground">
              Select the days you work. These are used to calculate per-day averages in Metrics.
            </p>
            <div className="flex flex-wrap gap-2">
              {DAY_LABELS.map((label, d) => {
                const checked = workingDays.includes(d)
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(d)}
                    className={`flex cursor-pointer flex-col items-center gap-1 rounded-md border px-3 py-2 text-xs transition-colors ${
                      checked
                        ? "border-primary bg-primary/10 font-medium text-primary"
                        : "border-muted-foreground/20 text-muted-foreground hover:border-muted-foreground/40"
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={saving || !hasChanges}>
              {saving ? "Saving…" : "Save"}
            </Button>
            {saved && <span className="text-xs text-green-600">Saved!</span>}
          </div>
        </CardContent>
      </Card>
    </form>
  )
}
