"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  PlusIcon,
  Trash2Icon,
  FlaskConicalIcon,
  ZapIcon,
  BellIcon,
  ClockIcon,
  WebhookIcon,
  GripVerticalIcon,
  ChevronDownIcon,
  CheckIcon,
  AlertCircleIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { fieldsForKind, getField, operatorsForField } from "@/lib/automation/fields"
import type {
  Action,
  ActionKind,
  AutomationRule,
  Condition,
  ConditionGroup,
  ConditionTree,
  Operator,
  RuleKind,
} from "@/lib/automation/types"

// ── constants ────────────────────────────────────────────────────────────────
const ACTION_KINDS: { kind: ActionKind; label: string; description: string }[] = [
  { kind: "alert.in_app", label: "In-app alert", description: "Get notified in the dashboard" },
  { kind: "alert.slack", label: "Slack DM", description: "Send you a Slack message (M6)" },
  { kind: "case.flag", label: "Flag case", description: "Mark case with priority hint" },
  { kind: "case.suggest_playbook", label: "Suggest playbook", description: "Link a playbook to the case" },
  { kind: "draft.prestage", label: "Pre-stage draft", description: "Prepare a draft response (M6)" },
  { kind: "flow.stop", label: "Stop processing", description: "No further rules run on this case" },
]

const OP_LABELS: Record<Operator, string> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
  not_contains: "does not contain",
  matches_regex: "matches regex",
  in: "is any of",
  eq: "=",
  neq: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  is_empty: "is empty",
  not_empty: "is not empty",
  is_true: "is true",
  is_false: "is false",
}

const NO_VALUE_OPS: Operator[] = ["is_empty", "not_empty", "is_true", "is_false"]

function emptyTree(): ConditionTree {
  return { match: "any", groups: [{ match: "all", conditions: [] }] }
}

function blankRule(kind: RuleKind): Partial<AutomationRule> {
  return {
    name: "",
    description: "",
    kind,
    enabled: false,
    priority: 100,
    conditions: emptyTree(),
    actions: [{ kind: "alert.in_app" }],
    sweepEveryMins: kind === "monitor" ? 5 : null,
    onEvents: kind === "trigger" ? ["conversation.created", "conversation.updated"] : null,
  }
}

// ── component ─────────────────────────────────────────────────────────────────
type Alert = {
  id: string
  body: string
  kind: string
  created_at: string
  automation_rules?: { name?: string }
}

export function AutomationClient() {
  const [rules, setRules] = useState<AutomationRule[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Partial<AutomationRule> | null>(null)
  const [runningRules, setRunningRules] = useState<Set<string>>(new Set())

  const loadRules = useCallback(async () => {
    const res = await fetch("/api/automation/rules")
    const data = await res.json()
    if (res.ok) setRules(data.rules ?? [])
    else toast.error(data.error ?? "Failed to load rules")
  }, [])

  const loadAlerts = useCallback(async () => {
    const res = await fetch("/api/automation/alerts")
    const data = await res.json()
    if (res.ok) setAlerts(data.alerts ?? [])
    else toast.error(data.error ?? "Failed to load alerts")
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      await Promise.all([loadRules(), loadAlerts()])
      if (active) setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [loadRules, loadAlerts])

  async function toggleEnabled(rule: AutomationRule) {
    const res = await fetch(`/api/automation/rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !rule.enabled }),
    })
    if (res.ok) {
      toast.success(rule.enabled ? "Rule disabled" : "Rule enabled")
      loadRules()
    } else toast.error("Failed to update rule")
  }

  async function runRule(id: string, name: string) {
    setRunningRules((prev) => new Set(prev).add(id))
    try {
      const res = await fetch(`/api/automation/rules/${id}/run`, { method: "POST" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error ?? "Failed to run rule")
        return
      }
      const data = await res.json()
      toast.success(
        `${name}: ${data.matches} match(es) of ${data.casesEvaluated} case(s), ${data.actionsApplied} action(s) applied`
      )
      if (data.errors?.length) {
        data.errors.forEach((e: string) => toast.error(e))
      }
    } finally {
      setRunningRules((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  async function markAlertsRead(ids: string[]) {
    const res = await fetch("/api/automation/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    })
    if (res.ok) loadAlerts()
  }

  return (
    <Tabs defaultValue="rules" className="gap-6">
      <div className="flex items-center justify-between">
        <TabsList className="h-10">
          <TabsTrigger value="rules" className="gap-1.5 px-3">
            <ZapIcon className="size-3.5" /> Rules
          </TabsTrigger>
          <TabsTrigger value="alerts" className="gap-1.5 px-3">
            <BellIcon className="size-3.5" /> Alerts
            {alerts.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                {alerts.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setEditing(blankRule("trigger"))}
          >
            <WebhookIcon className="size-3.5" /> New trigger
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => setEditing(blankRule("monitor"))}>
            <ClockIcon className="size-3.5" /> New monitor
          </Button>
        </div>
      </div>

      <TabsContent value="rules">
        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <div className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Loading rules…
          </div>
        ) : rules.length === 0 ? (
          <EmptyState onNewMonitor={() => setEditing(blankRule("monitor"))} onNewTrigger={() => setEditing(blankRule("trigger"))} />
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[30%]">Name</TableHead>
                  <TableHead className="w-[10%]">Kind</TableHead>
                  <TableHead className="w-[10%]">Priority</TableHead>
                  <TableHead className="w-[35%]">Actions</TableHead>
                  <TableHead className="w-[15%] text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer transition-colors hover:bg-muted/50"
                    onClick={() => setEditing(r)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <GripVerticalIcon className="size-4 text-muted-foreground/50" />
                        <span className="font-medium">{r.name || "Untitled rule"}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          r.kind === "monitor"
                            ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
                            : "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300"
                        }
                      >
                        {r.kind === "monitor" ? (
                          <ClockIcon className="mr-1 size-3" />
                        ) : (
                          <WebhookIcon className="mr-1 size-3" />
                        )}
                        {r.kind}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.priority}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        {r.actions.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {r.actions.slice(0, 3).map((a, i) => (
                              <Badge key={i} variant="secondary" className="text-xs">
                                {ACTION_KINDS.find((k) => k.kind === a.kind)?.label ?? a.kind}
                              </Badge>
                            ))}
                            {r.actions.length > 3 && (
                              <Badge variant="secondary" className="text-xs">
                                +{r.actions.length - 3}
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="italic">No actions</span>
                        )}
                        {r.kind === "monitor" && (
                          <button
                            onClick={(e) => { e.stopPropagation(); runRule(r.id, r.name) }}
                            disabled={runningRules.has(r.id)}
                            className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {runningRules.has(r.id) ? (
                              <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            ) : (
                              <ClockIcon className="size-3" />
                            )}{" "}
                            {runningRules.has(r.id) ? "Running…" : "Run"}
                          </button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => toggleEnabled(r)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${
                          r.enabled ? "bg-primary" : "bg-input"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block size-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                            r.enabled ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </TabsContent>

      <TabsContent value="alerts">
        {alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
            <BellIcon className="mb-3 size-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No unread alerts yet.</p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              Alerts appear when a rule matches a case.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" onClick={() => markAlertsRead(alerts.map((a) => a.id))}>
                Mark all read
              </Button>
            </div>
            {alerts.map((a) => (
              <div
                key={a.id}
                className="flex items-start justify-between rounded-lg border bg-card p-4 transition-colors hover:bg-muted/30"
              >
                <div className="flex gap-3">
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
                    <AlertCircleIcon className="size-4" />
                  </div>
                  <div>
                    <p className="text-sm">{a.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {a.automation_rules?.name ?? "rule"} · {new Date(a.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => markAlertsRead([a.id])}>
                  Dismiss
                </Button>
              </div>
            ))}
          </div>
        )}
      </TabsContent>

      {editing && (
        <RuleEditor
          rule={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            loadRules()
          }}
        />
      )}
    </Tabs>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState({
  onNewMonitor,
  onNewTrigger,
}: {
  onNewMonitor: () => void
  onNewTrigger: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-primary/10">
        <ZapIcon className="size-6 text-primary" />
      </div>
      <h3 className="text-lg font-semibold">Automate your support workflow</h3>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        Create rules that monitor cases or trigger on events. Actions stay draft-only — nothing
        goes to customers without your review.
      </p>
      <div className="mt-6 flex gap-3">
        <Button variant="outline" className="gap-2" onClick={onNewMonitor}>
          <ClockIcon className="size-4" /> New monitor
        </Button>
        <Button className="gap-2" onClick={onNewTrigger}>
          <WebhookIcon className="size-4" /> New trigger
        </Button>
      </div>
    </div>
  )
}

// ── Rule editor modal ─────────────────────────────────────────────────────────
function RuleEditor({
  rule,
  onClose,
  onSaved,
}: {
  rule: Partial<AutomationRule>
  onClose: () => void
  onSaved: () => void
}) {
  const [draft, setDraft] = useState<Partial<AutomationRule>>(rule)
  const [testResult, setTestResult] = useState<{ scanned: number; matches: unknown[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<"basics" | "conditions" | "actions">("basics")
  const isEdit = Boolean(rule.id)
  const kind = (draft.kind ?? "monitor") as RuleKind
  const tree = draft.conditions ?? emptyTree()

  function setTree(next: ConditionTree) {
    setDraft((d) => ({ ...d, conditions: next }))
    setTestResult(null)
  }

  async function save() {
    setBusy(true)
    const payload = {
      name: draft.name,
      description: draft.description,
      kind,
      enabled: draft.enabled ?? false,
      priority: draft.priority ?? 100,
      conditions: tree,
      actions: draft.actions ?? [],
      sweepEveryMins: kind === "monitor" ? draft.sweepEveryMins ?? 5 : null,
      onEvents: kind === "trigger" ? draft.onEvents ?? [] : null,
    }
    const res = await fetch(isEdit ? `/api/automation/rules/${rule.id}` : "/api/automation/rules", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    setBusy(false)
    if (res.ok) {
      toast.success(isEdit ? "Rule saved" : "Rule created")
      onSaved()
    } else {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error ?? "Save failed")
    }
  }

  async function remove() {
    if (!rule.id) return
    setBusy(true)
    const res = await fetch(`/api/automation/rules/${rule.id}`, { method: "DELETE" })
    setBusy(false)
    if (res.ok) {
      toast.success("Rule deleted")
      onSaved()
    } else toast.error("Delete failed")
  }

  async function runTest() {
    setBusy(true)
    const res = await fetch("/api/automation/rules/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conditions: tree, actions: draft.actions ?? [] }),
    })
    const data = await res.json()
    setBusy(false)
    if (res.ok) {
      setTestResult(data)
      toast.success(`${data.matches.length}/${data.scanned} cases would match`)
    } else toast.error(data.error ?? "Test failed")
  }

  const steps = [
    { key: "basics", label: "Basics" },
    { key: "conditions", label: "Conditions" },
    { key: "actions", label: "Actions" },
  ] as const

  const currentIdx = steps.findIndex((s) => s.key === step)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 pb-4 pt-6">
          <DialogTitle className="text-lg">
            {isEdit ? "Edit rule" : `New ${kind}`}
          </DialogTitle>
          <DialogDescription>
            {kind === "monitor"
              ? "Periodically scan open cases against your conditions."
              : "Fire when an Intercom event matches your conditions."}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1 border-b px-6 py-3">
          {steps.map((s, i) => (
            <div key={s.key} className="flex items-center">
              <button
                onClick={() => setStep(s.key)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  step === s.key
                    ? "bg-primary text-primary-foreground"
                    : i < currentIdx
                      ? "text-primary hover:bg-primary/10"
                      : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {i < currentIdx ? (
                  <CheckIcon className="size-3" />
                ) : (
                  <span className="flex size-4 items-center justify-center rounded-full border text-[10px]">
                    {i + 1}
                  </span>
                )}
                {s.label}
              </button>
              {i < steps.length - 1 && <div className="mx-1 h-px w-4 bg-border" />}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === "basics" && (
            <BasicsStep draft={draft} setDraft={setDraft} kind={kind} />
          )}
          {step === "conditions" && (
            <ConditionsStep tree={tree} setTree={setTree} kind={kind} />
          )}
          {step === "actions" && (
            <ActionsStep
              actions={draft.actions ?? []}
              onChange={(actions) => setDraft({ ...draft, actions })}
              testResult={testResult}
              onTest={runTest}
              busy={busy}
            />
          )}
        </div>

        <DialogFooter className="flex flex-row items-center justify-between border-t px-6 py-4">
          <div className="flex items-center gap-2">
            {isEdit && (
              <Button variant="destructive" size="sm" onClick={remove} disabled={busy}>
                <Trash2Icon className="mr-1 size-3.5" /> Delete
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={draft.enabled ?? false}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                className="size-3.5 rounded border-input"
              />
              Enabled
            </label>
            <Separator orientation="vertical" className="h-5" />
            {currentIdx > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setStep(steps[currentIdx - 1].key)}>
                Back
              </Button>
            )}
            {currentIdx < steps.length - 1 ? (
              <Button size="sm" onClick={() => setStep(steps[currentIdx + 1].key)}>
                Next
              </Button>
            ) : (
              <Button size="sm" onClick={save} disabled={busy}>
                {isEdit ? "Save changes" : "Create rule"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function blankWithKind(draft: Partial<AutomationRule>, kind: RuleKind): Partial<AutomationRule> {
  return {
    ...draft,
    kind,
    sweepEveryMins: kind === "monitor" ? draft.sweepEveryMins ?? 5 : null,
    onEvents: kind === "trigger" ? draft.onEvents ?? ["conversation.created", "conversation.updated"] : null,
  }
}

// ── Step: Basics ──────────────────────────────────────────────────────────────
function BasicsStep({
  draft,
  setDraft,
  kind,
}: {
  draft: Partial<AutomationRule>
  setDraft: (d: Partial<AutomationRule>) => void
  kind: RuleKind
}) {
  return (
    <div className="grid gap-5">
      <div className="grid gap-1.5">
        <Label htmlFor="name" className="text-sm font-medium">
          Name
        </Label>
        <Input
          id="name"
          value={draft.name ?? ""}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="e.g. Flag stale payout cases"
          className="h-10"
        />
        <p className="text-xs text-muted-foreground">
          A descriptive name helps you identify this rule at a glance.
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label className="text-sm font-medium">Type</Label>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setDraft({ ...blankWithKind(draft, "monitor"), name: draft.name, description: draft.description })}
            className={`flex flex-col items-start gap-1 rounded-lg border-2 p-4 text-left transition-colors ${
              kind === "monitor"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground/30 hover:bg-muted/30"
            }`}
          >
            <div className="flex items-center gap-2">
              <ClockIcon className={`size-4 ${kind === "monitor" ? "text-primary" : "text-muted-foreground"}`} />
              <span className="text-sm font-medium">Monitor</span>
            </div>
            <span className="text-xs text-muted-foreground">Periodically scan cases on a schedule</span>
          </button>
          <button
            onClick={() => setDraft({ ...blankWithKind(draft, "trigger"), name: draft.name, description: draft.description })}
            className={`flex flex-col items-start gap-1 rounded-lg border-2 p-4 text-left transition-colors ${
              kind === "trigger"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground/30 hover:bg-muted/30"
            }`}
          >
            <div className="flex items-center gap-2">
              <WebhookIcon className={`size-4 ${kind === "trigger" ? "text-primary" : "text-muted-foreground"}`} />
              <span className="text-sm font-medium">Trigger</span>
            </div>
            <span className="text-xs text-muted-foreground">Fire when an Intercom event occurs</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="prio" className="text-sm font-medium">
            Priority
          </Label>
          <Input
            id="prio"
            type="number"
            value={draft.priority ?? 100}
            onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })}
            className="h-10"
          />
          <p className="text-xs text-muted-foreground">Lower = runs first.</p>
        </div>
        {kind === "monitor" && (
          <div className="grid gap-1.5">
            <Label htmlFor="sweep" className="text-sm font-medium">
              Scan interval
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="sweep"
                type="number"
                value={draft.sweepEveryMins ?? 5}
                onChange={(e) => setDraft({ ...draft, sweepEveryMins: Number(e.target.value) })}
                className="h-10 w-24"
              />
              <span className="text-sm text-muted-foreground">minutes</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Step: Conditions ──────────────────────────────────────────────────────────
function ConditionsStep({
  tree,
  setTree,
  kind,
}: {
  tree: ConditionTree
  setTree: (t: ConditionTree) => void
  kind: RuleKind
}) {
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Conditions</Label>
        <Select
          value={tree.match}
          onValueChange={(v) => setTree({ ...tree, match: v as "all" | "any" })}
        >
          <SelectTrigger className="w-[180px] h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Match ANY group (OR)</SelectItem>
            <SelectItem value="all">Match ALL groups (AND)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3">
        {tree.groups.map((group, gi) => (
          <GroupEditor
            key={gi}
            group={group}
            kind={kind}
            isFirst={gi === 0}
            onChange={(g) => {
              const groups = [...tree.groups]
              groups[gi] = g
              setTree({ ...tree, groups })
            }}
            onRemove={() => setTree({ ...tree, groups: tree.groups.filter((_, i) => i !== gi) })}
          />
        ))}
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-fit gap-1.5"
        onClick={() => setTree({ ...tree, groups: [...tree.groups, { match: "all", conditions: [] }] })}
      >
        <PlusIcon className="size-3.5" /> Add OR group
      </Button>
    </div>
  )
}

// ── Group editor ───────────────────────────────────────────────────────────────
function GroupEditor({
  group,
  kind,
  isFirst,
  onChange,
  onRemove,
}: {
  group: ConditionGroup
  kind: RuleKind
  isFirst: boolean
  onChange: (g: ConditionGroup) => void
  onRemove: () => void
}) {
  const fields = fieldsForKind(kind)
  return (
    <div className="relative rounded-lg border bg-card p-4">
      {!isFirst && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full border bg-background px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          OR
        </div>
      )}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Group condition:</span>
          <Select
            value={group.match}
            onValueChange={(v) => onChange({ ...group, match: v as "all" | "any" })}
          >
            <SelectTrigger className="h-8 w-[120px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">ALL (AND)</SelectItem>
              <SelectItem value="any">ANY (OR)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {!isFirst && (
          <Button variant="ghost" size="sm" className="size-7 p-0 text-muted-foreground hover:text-destructive" onClick={onRemove}>
            <Trash2Icon className="size-3.5" />
          </Button>
        )}
      </div>

      <div className="grid gap-2">
        {group.conditions.map((cond, ci) => (
          <ConditionRow
            key={ci}
            cond={cond}
            fields={fields}
            onChange={(c) => {
              const conditions = [...group.conditions]
              conditions[ci] = c
              onChange({ ...group, conditions })
            }}
            onRemove={() => onChange({ ...group, conditions: group.conditions.filter((_, i) => i !== ci) })}
          />
        ))}
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="mt-3 gap-1.5 text-muted-foreground hover:text-foreground"
        onClick={() => {
          const first = fields[0]
          const op = (operatorsForField(first.key)[0] ?? "is") as Operator
          onChange({ ...group, conditions: [...group.conditions, { field: first.key, op }] })
        }}
      >
        <PlusIcon className="size-3.5" /> Add condition
      </Button>
    </div>
  )
}

// ── Condition row ───────────────────────────────────────────────────────────────
function ConditionRow({
  cond,
  fields,
  onChange,
  onRemove,
}: {
  cond: Condition
  fields: ReturnType<typeof fieldsForKind>
  onChange: (c: Condition) => void
  onRemove: () => void
}) {
  const field = getField(cond.field)
  const ops = operatorsForField(cond.field)
  const needsValue = !NO_VALUE_OPS.includes(cond.op)
  const isDuration = field?.type === "duration"
  const agentsFetched = useRef(false)
  const [agents, setAgents] = useState<Array<{ id: string; name: string | null; intercom_admin_id: string | null }>>([])
  useEffect(() => {
    if (cond.field === "teammate" && !agentsFetched.current) {
      agentsFetched.current = true
      fetch("/api/agents")
        .then((r) => r.json())
        .then((d) => setAgents(d.agents ?? []))
        .catch(() => {})
    }
  }, [cond.field])

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-3 py-2">
      <Select
        value={cond.field}
        onValueChange={(v) => {
          const nextOps = operatorsForField(v)
          onChange({ field: v, op: (nextOps[0] ?? "is") as Operator })
        }}
      >
        <SelectTrigger className="h-8 w-[160px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {fields.map((f) => (
            <SelectItem key={f.key} value={f.key}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={cond.op}
        onValueChange={(v) => onChange({ ...cond, op: v as Operator })}
      >
        <SelectTrigger className="h-8 w-[130px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ops.map((op) => (
            <SelectItem key={op} value={op}>
              {OP_LABELS[op]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {needsValue &&
        (field?.options ? (
          <Select
            value={String(cond.value ?? "")}
            onValueChange={(v) => onChange({ ...cond, value: v })}
          >
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {field.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : cond.field === "teammate" ? (
          <Select
            value={String(cond.value ?? "")}
            onValueChange={(v) => onChange({ ...cond, value: v })}
          >
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue placeholder="Select teammate…" />
            </SelectTrigger>
            <SelectContent>
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.intercom_admin_id ?? ""}>
                  {a.name ?? a.intercom_admin_id ?? "Unknown"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : field?.type === "tags" && (cond.op === "contains" || cond.op === "not_contains") ? (
          <TagPicker value={String(cond.value ?? "")} multi={false} onChange={(v) => onChange({ ...cond, value: v })} />
        ) : field?.type === "tags" && cond.op === "in" ? (
          <TagPicker
            value={Array.isArray(cond.value) ? cond.value : []}
            multi={true}
            onChange={(v) => onChange({ ...cond, value: Array.isArray(v) ? v : v ? [v] : [] })}
          />
        ) : isDuration ? (
          <div className="flex items-center gap-1.5">
            {cond.field === "first_response_minutes" && (
              <>
                <span className="text-xs text-muted-foreground">SLA</span>
                <Input
                  type="number"
                  className="h-8 w-16 text-xs"
                  placeholder="min"
                  value={cond.sla ?? ""}
                  onChange={(e) => onChange({ ...cond, sla: Number(e.target.value) || undefined })}
                />
                <span className="text-xs text-muted-foreground">min → alert when ≤</span>
              </>
            )}
            <Input
              type="number"
              className="h-8 w-20 text-xs"
              value={typeof cond.value === "number" ? Math.round(cond.value / 60) : ""}
              onChange={(e) => onChange({ ...cond, value: Number(e.target.value) * 60 })}
            />
            <span className="text-xs text-muted-foreground">min left</span>
          </div>
        ) : cond.op === "in" ? (
          <Input
            className="h-8 w-48 text-xs"
            placeholder="comma,separated"
            value={Array.isArray(cond.value) ? cond.value.join(",") : String(cond.value ?? "")}
            onChange={(e) =>
              onChange({ ...cond, value: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
            }
          />
        ) : (
          <Input
            className="h-8 w-48 text-xs"
            value={String(cond.value ?? "")}
            onChange={(e) => onChange({ ...cond, value: e.target.value })}
          />
        ))}

      <Button
        variant="ghost"
        size="sm"
        className="size-7 p-0 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
      >
        <Trash2Icon className="size-3.5" />
      </Button>
    </div>
  )
}

// ── Step: Actions ──────────────────────────────────────────────────────────────
function ActionsStep({
  actions,
  onChange,
  testResult,
  onTest,
  busy,
}: {
  actions: Action[]
  onChange: (a: Action[]) => void
  testResult: { scanned: number; matches: unknown[] } | null
  onTest: () => void
  busy: boolean
}) {
  return (
    <div className="grid gap-5">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
        <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
          Draft-only actions
        </p>
        <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-300/80">
          Actions alert you or annotate internal records — they never message the customer directly.
        </p>
      </div>

      <div className="grid gap-3">
        {actions.map((action, i) => (
          <div key={i} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
            <Select
              value={action.kind}
              onValueChange={(v) => {
                const next = [...actions]
                next[i] = { kind: v as ActionKind }
                onChange(next)
              }}
            >
              <SelectTrigger className="h-9 w-[200px] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTION_KINDS.map((a) => (
                  <SelectItem key={a.kind} value={a.kind}>
                    <div>
                      <span className="font-medium">{a.label}</span>
                      <span className="ml-1.5 text-xs text-muted-foreground">— {a.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {action.kind === "alert.in_app" || action.kind === "alert.slack" ? (
              <TextWithPlaceholders
                value={String(action.params?.text ?? "")}
                onChange={(text) => {
                  const next = [...actions]
                  next[i] = { ...action, params: { ...action.params, text } }
                  onChange(next)
                }}
              />
            ) : action.kind === "case.flag" ? (
              <Input
                className="h-9 flex-1 text-sm"
                placeholder="priority_hint e.g. urgent"
                value={String(action.params?.priority_hint ?? "")}
                onChange={(e) => {
                  const next = [...actions]
                  next[i] = { ...action, params: { ...action.params, priority_hint: e.target.value } }
                  onChange(next)
                }}
              />
            ) : null}

            <Button
              variant="ghost"
              size="sm"
              className="size-8 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => onChange(actions.filter((_, idx) => idx !== i))}
            >
              <Trash2Icon className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-fit gap-1.5"
        onClick={() => onChange([...actions, { kind: "alert.in_app" }])}
      >
        <PlusIcon className="size-3.5" /> Add action
      </Button>

      <Separator />

      {/* Test section */}
      <div className="rounded-lg border bg-muted/30 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Test this rule</p>
            <p className="text-xs text-muted-foreground">
              Check how many of your cases match these conditions.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="gap-1.5"
            onClick={onTest}
            disabled={busy}
          >
            <FlaskConicalIcon className="size-3.5" /> Run test
          </Button>
        </div>
        {testResult && (
          <div className="mt-3 flex items-center gap-2 rounded-md bg-background p-3 text-sm">
            <CheckIcon className="size-4 text-green-600" />
            <span>
              <strong>{testResult.matches.length}</strong> of {testResult.scanned} cases match.
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

const PLACEHOLDER_CHIPS = [
  { label: "Intercom link", value: "{{intercom_url}}" },
  { label: "Customer", value: "{{customer}}" },
  { label: "Subject", value: "{{subject}}" },
  { label: "Status", value: "{{status}}" },
  { label: "Teammate", value: "{{teammate}}" },
  { label: "Rule name", value: "{{rule_name}}" },
]

function TextWithPlaceholders({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)

  function insert(placeholder: string) {
    const input = ref.current
    if (!input) {
      onChange(value + placeholder)
      return
    }
    const start = input.selectionStart ?? value.length
    const end = input.selectionEnd ?? value.length
    const next = value.slice(0, start) + placeholder + value.slice(end)
    onChange(next)
    // Restore cursor after the inserted text on next tick.
    requestAnimationFrame(() => {
      input.selectionStart = input.selectionEnd = start + placeholder.length
      input.focus()
    })
  }

  return (
    <div className="flex flex-1 flex-col gap-1.5">
      <input
        ref={ref}
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        placeholder="Alert text (optional)"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="flex flex-wrap gap-1">
        {PLACEHOLDER_CHIPS.map((chip) => (
          <button
            key={chip.value}
            type="button"
            className="rounded-md border bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            onClick={() => insert(chip.value)}
          >
            {chip.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Tag picker ───────────────────────────────────────────────────────────────────

type TagItem = { id: string; name: string }

function TagPicker({
  value,
  multi,
  onChange,
}: {
  value: string | string[]
  multi: boolean
  onChange: (v: string | string[]) => void
}) {
  const fetched = useRef(false)
  const [tags, setTags] = useState<TagItem[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (fetched.current) return
    fetched.current = true
    fetch("/api/tags")
      .then((r) => r.json())
      .then((d) => setTags(d.tags ?? []))
      .catch(() => {})
  }, [])

  if (!multi) {
    return (
      <Select value={String(value ?? "")} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-[180px] text-xs">
          <SelectValue placeholder="Select tag…" />
        </SelectTrigger>
        <SelectContent>
          {tags.map((t) => (
            <SelectItem key={t.id} value={t.name}>
              {t.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  const selected = Array.isArray(value) ? value : []

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-8 min-w-[160px] max-w-[240px] items-center gap-1 rounded-md border border-input bg-background px-2 text-xs text-left"
      >
        {selected.length === 0 ? (
          <span className="text-muted-foreground">Select tags…</span>
        ) : (
          <span className="truncate">{selected.join(", ")}</span>
        )}
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{selected.length}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 max-h-48 w-[220px] overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
            {tags.map((t) => {
              const isSelected = selected.includes(t.name)
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`flex w-full items-center gap-2 rounded-sm px-2 py-1 text-xs hover:bg-accent ${
                    isSelected ? "bg-accent/60 font-medium" : ""
                  }`}
                  onClick={() => {
                    const next = isSelected ? selected.filter((s) => s !== t.name) : [...selected, t.name]
                    onChange(next)
                  }}
                >
                  <span className="size-3 rounded border border-input flex items-center justify-center">
                    {isSelected && <span className="size-2 rounded-sm bg-primary" />}
                  </span>
                  {t.name}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}