"use client"

import { useState } from "react"
import { UserIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { buildAgentGreeting } from "@/lib/agent-greeting"

// Blocking one-field card shown on Home when the signed-in agent has no
// agents.agent_name yet (see lib/agent-identity.ts). This is the ONLY name
// customers ever see in a draft, greeting, or quick-send email — it is
// deliberately separate from the agent's Google/internal display name, which
// customers never see. `suggestedName` prefills from the agent's matched
// Intercom admin display name when the auth callback found one (still empty
// the very first time an agent signs in, before any Intercom match exists).
export function AgentNameGate({
  suggestedName,
  onSaved,
}: {
  suggestedName?: string | null
  /** Called after a successful save, in addition to the default page reload. */
  onSaved?: () => void
}) {
  const [agentName, setAgentName] = useState(suggestedName ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = agentName.trim()
    if (!trimmed) {
      setError("Enter a name first.")
      return
    }

    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/settings/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentName: trimmed }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError((err as { error?: string }).error ?? "Couldn't save. Try again.")
        return
      }
      if (onSaved) {
        onSaved()
      } else {
        // Reload so the server-rendered briefing behind this gate picks up
        // the now-set agent_name.
        window.location.reload()
      }
    } catch {
      setError("Couldn't save. Try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <div className="flex items-center gap-2">
          <UserIcon className="size-4 text-muted-foreground" />
          <CardTitle className="text-base">Set your agent name</CardTitle>
        </div>
        <CardDescription>
          One quick thing before your briefing: customers see this name in reply greetings and
          quick-send emails. It stays separate from your Google account name, which is internal
          only. You can change it anytime in Settings.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agent-name-gate">Agent name</Label>
            <Input
              id="agent-name-gate"
              value={agentName}
              onChange={(e) => { setAgentName(e.target.value); setError(null) }}
              placeholder="Name customers will see"
              autoFocus
            />
          </div>

          <div className="rounded-md border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Preview: </span>
            {buildAgentGreeting(agentName)}
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <Button type="submit" size="sm" disabled={saving || !agentName.trim()}>
            {saving ? "Saving…" : "Save and continue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
