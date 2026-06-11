"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { PencilIcon, PlusIcon, Trash2Icon, WrenchIcon } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ToolIcon, TOOL_ICON_NAMES } from "@/lib/tool-icons"

export interface CaseToolItem {
  id: string
  name: string
  icon: string | null
  urlTemplate: string
  group: string | null
  tags: string[]
  isActive: boolean
  sortOrder: number
}

type EditorState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; tool: CaseToolItem }

const EMPTY = {
  name: "",
  icon: "",
  urlTemplate: "",
  group: "",
  tags: "",
  sortOrder: 0,
  isActive: true,
}

// Canvas tools CRUD (case_tools table). URL templates accept {{email}},
// {{handle}} and {{name}} — resolved with the case's customer context.
export function CaseToolsSettings({ tools }: { tools: CaseToolItem[] }) {
  const router = useRouter()
  const [editor, setEditor] = useState<EditorState>({ mode: "closed" })
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)

  const openCreate = () => {
    setForm(EMPTY)
    setEditor({ mode: "create" })
  }
  const openEdit = (tool: CaseToolItem) => {
    setForm({
      name: tool.name,
      icon: tool.icon ?? "",
      urlTemplate: tool.urlTemplate,
      group: tool.group ?? "",
      tags: tool.tags.join(", "),
      sortOrder: tool.sortOrder,
      isActive: tool.isActive,
    })
    setEditor({ mode: "edit", tool })
  }

  const submit = async () => {
    setBusy(true)
    const payload = {
      name: form.name.trim(),
      icon: form.icon.trim() || null,
      urlTemplate: form.urlTemplate.trim(),
      group: form.group.trim() || null,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      sortOrder: form.sortOrder,
      isActive: form.isActive,
    }
    const res =
      editor.mode === "edit"
        ? await fetch(`/api/case-tools/${editor.tool.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/case-tools", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
    setBusy(false)
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: res.statusText }))
      toast.error(`Failed to save tool: ${error}`)
      return
    }
    toast.success("Tool saved")
    setEditor({ mode: "closed" })
    router.refresh()
  }

  const remove = async (tool: CaseToolItem) => {
    if (!window.confirm(`Delete "${tool.name}" from the canvas toolbox?`)) return
    const res = await fetch(`/api/case-tools/${tool.id}`, { method: "DELETE" })
    if (!res.ok) {
      toast.error("Failed to delete tool")
      return
    }
    toast.success("Tool deleted")
    router.refresh()
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <WrenchIcon className="size-4 text-muted-foreground" />
          Canvas tools
        </CardTitle>
        <CardDescription>
          External tools available on the case canvas. URL templates accept{" "}
          <code className="text-xs">{"{{email}}"}</code>,{" "}
          <code className="text-xs">{"{{handle}}"}</code> and{" "}
          <code className="text-xs">{"{{name}}"}</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tool</TableHead>
              <TableHead>URL template</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tools.map((tool) => (
              <TableRow key={tool.id} className={tool.isActive ? "" : "opacity-50"}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    <ToolIcon
                      name={tool.icon}
                      className="size-3.5 text-muted-foreground"
                    />
                    {tool.name}
                  </span>
                  {!tool.isActive && (
                    <Badge variant="outline" className="ml-2">
                      inactive
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="max-w-64 truncate font-mono text-xs text-muted-foreground">
                  {tool.urlTemplate}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {tool.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="font-normal">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => openEdit(tool)}
                  >
                    <PencilIcon className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-destructive"
                    onClick={() => remove(tool)}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Button variant="outline" size="sm" className="w-fit" onClick={openCreate}>
          <PlusIcon className="size-3.5" />
          Add tool
        </Button>
      </CardContent>

      <Dialog
        open={editor.mode !== "closed"}
        onOpenChange={(open) => !open && setEditor({ mode: "closed" })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editor.mode === "edit" ? "Edit tool" : "New tool"}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-[1fr_80px] gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tool-name">Name</Label>
                <Input
                  id="tool-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Fadmin — Media Review"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tool-icon">Icon</Label>
                <Input
                  id="tool-icon"
                  value={form.icon}
                  onChange={(e) => setForm({ ...form, icon: e.target.value })}
                  placeholder="wrench"
                  title={`Available: ${TOOL_ICON_NAMES.join(", ")}`}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tool-url">URL template</Label>
              <Input
                id="tool-url"
                value={form.urlTemplate}
                onChange={(e) => setForm({ ...form, urlTemplate: e.target.value })}
                placeholder="https://fadmin.fanvue.com/users/{{email}}"
                className="font-mono text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tool-group">Group</Label>
                <Input
                  id="tool-group"
                  value={form.group}
                  onChange={(e) => setForm({ ...form, group: e.target.value })}
                  placeholder="Fadmin"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tool-tags">Tags (comma-separated)</Label>
                <Input
                  id="tool-tags"
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                  placeholder="kyc, payout"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              Active (shown in the canvas toolbox)
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditor({ mode: "closed" })}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy || !form.name || !form.urlTemplate}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
