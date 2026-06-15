"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import {
  addEdge,
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react"
import { useRouter } from "next/navigation"
import {
  BotIcon,
  DownloadIcon,
  GlobeIcon,
  MonitorIcon,
  NetworkIcon,
  PlusIcon,
  StickyNoteIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import "@xyflow/react/dist/style.css"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { ToolIcon } from "@/lib/tool-icons"
import { cn } from "@/lib/utils"
import { getCanvasHost } from "@/lib/canvas-host"
import { getPins } from "@/lib/canvas-pins"
import {
  FALLBACK_TOOLS,
  resolveToolUrl,
  suggestedTools,
  type CanvasTool,
} from "@/lib/canvas-tools"
import { CanvasActiveContext } from "@/components/canvas/active-context"
import { ToolNode } from "@/components/canvas/tool-node"
import { CaseInfoNode, type CaseInfoData } from "@/components/canvas/case-info-node"
import { DraftNode } from "@/components/canvas/draft-node"
import { NotesNode } from "@/components/canvas/notes-node"
import { AiNode, type AiNodeData } from "@/components/canvas/ai-node"
import { MacrosNode } from "@/components/canvas/macros-node"
import { QueueNode } from "@/components/canvas/queue-node"
import { QueueSidebar } from "@/components/canvas/queue-sidebar"
import {
  ConversationNode,
  type ConversationData,
} from "@/components/canvas/conversation-node"

export interface CaseCanvasProps {
  /** Absent on the ad-hoc canvas (/canvas) */
  caseInfo?: CaseInfoData
  /** Intercom thread, rendered as a Conversation card on case canvases */
  conversation?: ConversationData
  playbookId?: string
  playbookName?: string
  /** Subject + customer messages — drives keyword-based tool suggestions */
  ticketText?: string
  /** localStorage key suffix — conversation id or "adhoc:<id>" */
  storageKey: string
  /** From the case_tools table (server-fetched); falls back when omitted */
  tools?: CanvasTool[]
  /** Latest desktop build — shown on the browser gate */
  downloadUrl?: string
  /** False when this canvas is a hidden pane in the keep-alive workspace.
      Drives the active context so embedded tools pause while off-screen.
      Defaults to true for the standalone route-per-canvas pages. */
  active?: boolean
  /** True when several canvases are mounted at once (workspace host). Then we
      must NOT closeAllTools on unmount — that would kill the visible pane's
      tools too; per-card teardown (gated on `active`) handles it instead. */
  multiplexed?: boolean
}

// false during SSR/hydration, true once mounted on the client — lets us read
// window.canvasHost without a hydration mismatch
function useMounted() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )
}

const STORAGE_PREFIX = "fv-canvas-layout-v1:"
const nodeTypes = {
  tool: ToolNode,
  "case-info": CaseInfoNode,
  draft: DraftNode,
  notes: NotesNode,
  ai: AiNode,
  macros: MacrosNode,
  queue: QueueNode,
  conversation: ConversationNode,
}

// Graph overlay (link wires) visibility — global preference
const EDGES_KEY = "fv-canvas-edges-visible"
const EDGES_EVENT = "fv-canvas-edges-toggled"
function subscribeEdges(cb: () => void) {
  window.addEventListener(EDGES_EVENT, cb)
  window.addEventListener("storage", cb)
  return () => {
    window.removeEventListener(EDGES_EVENT, cb)
    window.removeEventListener("storage", cb)
  }
}
function readEdgesVisible(): string {
  try {
    return localStorage.getItem(EDGES_KEY) ?? "1"
  } catch {
    return "1"
  }
}

// Toolbox group order — groups not listed come after, alphabetically
const GROUP_ORDER = ["Fanvue", "KYC", "Payments", "Workspace", "Personal"]

function groupTools(tools: CanvasTool[]): Array<[string, CanvasTool[]]> {
  const byGroup = new Map<string, CanvasTool[]>()
  for (const tool of tools) {
    const key = tool.group || "Other"
    byGroup.set(key, [...(byGroup.get(key) ?? []), tool])
  }
  return [...byGroup.entries()].sort(([a], [b]) => {
    const ia = GROUP_ORDER.indexOf(a)
    const ib = GROUP_ORDER.indexOf(b)
    if (ia === -1 && ib === -1) return a.localeCompare(b)
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
}

type SavedLayout = {
  nodes: Array<Pick<Node, "id" | "type" | "position" | "width" | "height" | "data">>
  edges: Edge[]
}

function toolNode(
  tool: CanvasTool,
  url: string,
  position: { x: number; y: number },
  ghost = false,
): Node {
  return {
    id: `tool:${tool.id}`,
    type: "tool",
    position,
    width: 640,
    height: 520,
    data: { label: tool.name, icon: tool.icon, url, ghost },
  }
}

function caseToolEdge(toolNodeId: string): Edge {
  // Automatic primary edge: case → tool ("opened from this case")
  return {
    id: `e:case:${toolNodeId}`,
    source: "case-info",
    target: toolNodeId,
    label: "opened",
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { strokeDasharray: "4 4" },
  }
}

function buildDefaultLayout(props: CaseCanvasProps): SavedLayout {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const tools = props.tools ?? FALLBACK_TOOLS
  const ctx = {
    email: props.caseInfo?.customerEmail,
    name: props.caseInfo?.customerName,
  }

  if (props.caseInfo) {
    if (props.conversation) {
      nodes.push({
        id: "conversation",
        type: "conversation",
        position: { x: -480, y: 0 },
        width: 420,
        height: 560,
        data: props.conversation,
      })
    }
    nodes.push({
      id: "case-info",
      type: "case-info",
      position: { x: 0, y: 0 },
      width: 320,
      height: 460,
      data: props.caseInfo,
    })
    nodes.push({
      id: "draft",
      type: "draft",
      position: { x: 0, y: 280 },
      width: 380,
      height: 420,
      data: {
        conversationId: props.caseInfo.conversationId,
        playbookId: props.playbookId,
        playbookName: props.playbookName,
      },
    })
    nodes.push({
      id: "notes",
      type: "notes",
      position: { x: 0, y: 750 },
      width: 380,
      height: 180,
      data: { text: "" },
    })
    nodes.push({
      id: "macros",
      type: "macros",
      position: { x: 0, y: 960 },
      width: 380,
      height: 320,
      data: { conversationId: props.caseInfo.conversationId },
    })
    // Case copilot — open by default, knows the full ticket + playbooks
    nodes.push({
      id: "ai",
      type: "ai",
      position: { x: -480, y: 620 },
      width: 420,
      height: 380,
      data: { conversationId: props.caseInfo.conversationId },
    })
    // Suggested tools by Intercom tag OR ticket keywords (Fadmin always) —
    // ghost cards: nothing loads until the agent confirms.
    suggestedTools(tools, props.caseInfo.tags, props.ticketText).forEach((tool, i) => {
      const url = resolveToolUrl(tool.urlTemplate, ctx)
      if (!url) return
      const node = toolNode(tool, url, { x: 460, y: i * 580 }, true)
      nodes.push(node)
      edges.push(caseToolEdge(node.id))
    })
  }
  // Ad-hoc canvases start empty — everything is added from the toolbox.
  return { nodes, edges }
}

function loadLayout(key: string, props: CaseCanvasProps): SavedLayout {
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const saved = JSON.parse(raw) as SavedLayout
      if (Array.isArray(saved.nodes) && saved.nodes.length > 0) {
        // Live data (case info, draft context) must never come from storage —
        // refresh it from the server-provided props, keep saved geometry.
        const nodes = saved.nodes.map((n) => {
          if (n.type === "case-info" && props.caseInfo) {
            // Fresh Intercom data + the agent's saved corrections (overrides)
            const overrides = (n.data as Partial<CaseInfoData>)?.overrides
            return { ...n, data: { ...props.caseInfo, overrides } }
          }
          if (n.type === "conversation" && props.conversation) {
            return { ...n, data: props.conversation }
          }
          if (n.type === "ai" && props.caseInfo) {
            // Refresh the live conversationId, but keep the saved transcript so
            // the copilot chat survives reloads.
            return {
              ...n,
              data: {
                conversationId: props.caseInfo.conversationId,
                messages: (n.data as AiNodeData).messages,
              },
            }
          }
          if (n.type === "macros" && props.caseInfo) {
            return {
              ...n,
              data: { conversationId: props.caseInfo.conversationId },
            }
          }
          if (n.type === "draft" && props.caseInfo) {
            return {
              ...n,
              data: {
                conversationId: props.caseInfo.conversationId,
                playbookId: props.playbookId,
                playbookName: props.playbookName,
              },
            }
          }
          return n
        })
        // Layouts saved before the Conversation card existed: inject it
        if (
          props.conversation &&
          !nodes.some((n) => n.type === "conversation")
        ) {
          nodes.unshift({
            id: "conversation",
            type: "conversation",
            position: { x: -480, y: 0 },
            width: 420,
            height: 560,
            data: props.conversation,
          })
        }
        // Layouts saved before the Macros card existed: inject it
        if (props.caseInfo && !nodes.some((n) => n.type === "macros")) {
          nodes.push({
            id: "macros",
            type: "macros",
            position: { x: 0, y: 960 },
            width: 380,
            height: 320,
            data: { conversationId: props.caseInfo.conversationId },
          })
        }
        return { nodes: nodes as Node[], edges: saved.edges ?? [] }
      }
    }
  } catch {
    // corrupted layout — fall through to defaults
  }
  return buildDefaultLayout(props)
}

// Pinned cards keep one global geometry on every canvas and can't be dragged
function applyPins(layout: SavedLayout): { nodes: Node[]; edges: Edge[] } {
  let pins: ReturnType<typeof getPins> = {}
  try {
    pins = getPins()
  } catch {
    // SSR — no pins
  }
  const nodes: Node[] = (layout.nodes as Node[]).map((n) => {
    const pin = pins[n.id]
    if (!pin) return n
    return {
      ...n,
      position: pin.position,
      width: pin.width ?? n.width,
      height: pin.height ?? n.height,
      draggable: false,
      // nopan keeps a non-draggable card interactive (text selection / clicks);
      // React Flow only adds it to draggable nodes. See PinButton.
      className: n.className ? `${n.className} nopan` : "nopan",
    }
  })
  return { nodes, edges: layout.edges }
}

function CanvasInner(props: CaseCanvasProps) {
  const host = getCanvasHost()
  const active = props.active ?? true
  const multiplexed = props.multiplexed ?? false
  const storageKey = STORAGE_PREFIX + props.storageKey
  const initial = useMemo(
    () => applyPins(loadLayout(storageKey, props)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storageKey],
  )
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges)
  const { fitView } = useReactFlow()

  // Obsidian-style link wires — global on/off toggle; the wires render in the
  // SVG layer beneath the cards, never on top of them.
  const edgesVisible =
    useSyncExternalStore(subscribeEdges, readEdgesVisible, () => "1") === "1"
  const toggleEdges = () => {
    try {
      localStorage.setItem(EDGES_KEY, edgesVisible ? "0" : "1")
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event(EDGES_EVENT))
  }

  // Debounced persistence of geometry + notes + edges
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const payload: SavedLayout = {
        nodes: nodes.map(({ id, type, position, width, height, data }) => ({
          id,
          type,
          position,
          width,
          height,
          data,
        })),
        edges,
      }
      try {
        localStorage.setItem(storageKey, JSON.stringify(payload))
      } catch {
        // storage full/unavailable — layout just won't persist
      }
    }, 400)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [nodes, edges, storageKey])

  // Leaving the page must never strand native views over the UI. In the
  // workspace host several canvases are mounted at once, so a blanket
  // closeAllTools() on unmount would tear down the visible pane's tools too —
  // there, per-card teardown (ToolNode, gated on `active`) does the cleanup.
  useEffect(() => {
    if (multiplexed) return
    return () => getCanvasHost()?.closeAllTools()
  }, [multiplexed])

  // Panes in the workspace mount hidden (zero-size), so the initial fitView
  // runs against an empty box. Re-fit the first time this pane is actually
  // shown; afterwards the user's pan/zoom is left untouched.
  const fittedRef = useRef(false)
  useEffect(() => {
    if (!active || fittedRef.current) return
    fittedRef.current = true
    const t = setTimeout(() => fitView({ padding: 0.1 }), 60)
    return () => clearTimeout(t)
  }, [active, fitView])

  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((eds) =>
        addEdge(
          { ...connection, markerEnd: { type: MarkerType.ArrowClosed } },
          eds,
        ),
      ),
    [setEdges],
  )

  const addTool = useCallback(
    (tool: CanvasTool) => {
      // Use the case-info card's current values — including any overrides the
      // agent saved (e.g. corrected customer email) — for URL templates.
      const infoData = nodes.find((n) => n.type === "case-info")?.data as
        | CaseInfoData
        | undefined
      const url = resolveToolUrl(tool.urlTemplate, {
        email:
          infoData?.overrides?.customerEmail ??
          infoData?.customerEmail ??
          props.caseInfo?.customerEmail,
        name:
          infoData?.overrides?.customerName ??
          infoData?.customerName ??
          props.caseInfo?.customerName,
      })
      if (!url) return
      setNodes((nds) => {
        if (nds.some((n) => n.id === `tool:${tool.id}`)) return nds
        const maxX = Math.max(0, ...nds.map((n) => n.position.x + (n.width ?? 0)))
        // Explicitly added by the agent → loads immediately (not a ghost)
        return [...nds, toolNode(tool, url, { x: maxX + 60, y: 0 })]
      })
      if (props.caseInfo) {
        setEdges((eds) =>
          eds.some((e) => e.id === `e:case:tool:${tool.id}`)
            ? eds
            : [...eds, caseToolEdge(`tool:${tool.id}`)],
        )
      }
    },
    [nodes, props.caseInfo, setNodes, setEdges],
  )

  // Command palette → "Open <tool> on canvas"
  const toolsRef = useRef(props.tools ?? FALLBACK_TOOLS)
  useEffect(() => {
    toolsRef.current = props.tools ?? FALLBACK_TOOLS
  }, [props.tools])
  useEffect(() => {
    const handler = (e: Event) => {
      const toolId = (e as CustomEvent<{ toolId: string }>).detail?.toolId
      const tool = toolsRef.current.find((t) => t.id === toolId)
      if (tool) addTool(tool)
    }
    window.addEventListener("canvas-add-tool", handler)
    return () => window.removeEventListener("canvas-add-tool", handler)
  }, [addTool])

  const addNote = useCallback(() => {
    setNodes((nds) => [
      ...nds,
      {
        id: `notes:${nds.length}-${nds.filter((n) => n.type === "notes").length}`,
        type: "notes",
        position: { x: 60 + nds.length * 20, y: 60 + nds.length * 20 },
        width: 300,
        height: 180,
        data: { text: "" },
      },
    ])
  }, [setNodes])

  // Singleton cards (one AI assistant / one queue per canvas)
  const addSingleton = useCallback(
    (type: "ai" | "queue") => {
      setNodes((nds) => {
        if (nds.some((n) => n.id === type)) return nds
        const maxX = Math.max(0, ...nds.map((n) => n.position.x + (n.width ?? 0)))
        return [
          ...nds,
          {
            id: type,
            type,
            position: { x: maxX + 60, y: 0 },
            width: type === "ai" ? 340 : 300,
            height: 420,
            data:
              type === "ai" && props.caseInfo
                ? { conversationId: props.caseInfo.conversationId }
                : {},
          },
        ]
      })
    },
    [setNodes, props.caseInfo],
  )

  const router = useRouter()

  const deletePersonalLink = useCallback(
    async (tool: CanvasTool) => {
      if (!window.confirm(`Delete "${tool.name}" from your Personal tools?`)) return
      const res = await fetch(`/api/case-tools/${tool.id}`, { method: "DELETE" })
      if (!res.ok) {
        toast.error("Couldn't delete the link")
        return
      }
      toast.success("Link deleted")
      router.refresh()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // "Personal" custom links — saved to case_tools so they survive everywhere
  const [customOpen, setCustomOpen] = useState(false)
  const [customForm, setCustomForm] = useState({ name: "", url: "" })
  const [customBusy, setCustomBusy] = useState(false)
  const saveCustomLink = useCallback(async () => {
    setCustomBusy(true)
    const res = await fetch("/api/case-tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: customForm.name.trim(),
        urlTemplate: customForm.url.trim(),
        icon: "link",
        group: "Personal",
        sortOrder: 100,
        tags: [],
      }),
    })
    setCustomBusy(false)
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: res.statusText }))
      toast.error(`Couldn't save the link: ${error}`)
      return
    }
    toast.success("Saved to your Personal tools")
    setCustomOpen(false)
    setCustomForm({ name: "", url: "" })
    router.refresh()
  }, [customForm, router])

  const resetLayout = useCallback(() => {
    localStorage.removeItem(storageKey)
    const fresh = buildDefaultLayout(props)
    setNodes(fresh.nodes)
    setEdges(fresh.edges)
    setTimeout(() => fitView({ padding: 0.1 }), 50)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, setNodes, setEdges, fitView])

  const mounted = useMounted()
  // The canvas is a desktop-only feature: embedded tools need the Electron
  // shell. In a regular browser, gate it behind the download link.
  if (mounted && !host) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="flex max-w-sm flex-col items-center gap-4 rounded-xl border bg-card p-8 text-center shadow-sm">
          <MonitorIcon className="size-8 text-primary" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold">
              This feature is only available in the desktop app
            </p>
            <p className="text-xs text-muted-foreground">
              The canvas embeds Fadmin, ONDATO, MassPay and your other tools as
              live, signed-in views — that needs the desktop shell.
            </p>
          </div>
          <Button asChild>
            <a
              href={props.downloadUrl ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
            >
              <DownloadIcon className="size-4" />
              Download the app — get the full experience
            </a>
          </Button>
        </div>
      </div>
    )
  }
  if (!mounted) {
    return <div className="h-full w-full" />
  }

  return (
    <CanvasActiveContext.Provider value={active}>
    <div className="relative h-full w-full">
      <QueueSidebar />

      {/* Toolbox */}
      <div className="absolute right-4 top-4 z-10 flex max-h-[calc(100%-6rem)] flex-col items-end gap-1.5">
        <div className="flex items-center gap-1.5">
          <button
            onClick={toggleEdges}
            title={edgesVisible ? "Hide link wires" : "Show link wires"}
            className={cn(
              "flex size-6 items-center justify-center rounded-md border bg-card/95 shadow-sm backdrop-blur transition-colors",
              edgesVisible
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <NetworkIcon className="size-3.5" />
          </button>
          <Badge variant="secondary" className="gap-1.5 font-normal">
            {host ? (
              <>
                <MonitorIcon className="size-3" /> Desktop — embedded tools
              </>
            ) : (
              <>
                <GlobeIcon className="size-3" /> Web — tools open in new tabs
              </>
            )}
          </Badge>
        </div>
        <div className="flex flex-col gap-1 overflow-y-auto rounded-xl border bg-card/95 p-2 shadow-md backdrop-blur">
          <span className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Cards
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 justify-start gap-2 text-xs"
            onClick={() => addSingleton("ai")}
          >
            <BotIcon className="size-3" />
            AI Assistant
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 justify-start gap-2 text-xs"
            onClick={addNote}
          >
            <StickyNoteIcon className="size-3" />
            Note
          </Button>

          {groupTools(props.tools ?? FALLBACK_TOOLS).map(([group, tools]) => (
            <div key={group} className="flex flex-col gap-1">
              <Separator className="my-1" />
              <span className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {group}
              </span>
              {tools.map((tool) => (
                <div key={tool.id} className="group/tool flex items-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 flex-1 justify-start gap-2 text-xs"
                    onClick={() => addTool(tool)}
                  >
                    <ToolIcon name={tool.icon} className="size-3" />
                    {tool.name}
                  </Button>
                  {group === "Personal" && (
                    <button
                      className="shrink-0 px-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/tool:opacity-100"
                      title={`Delete "${tool.name}"`}
                      onClick={() => void deletePersonalLink(tool)}
                    >
                      <Trash2Icon className="size-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}

          <Separator className="my-1" />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 justify-start gap-2 text-xs"
            onClick={() => setCustomOpen(true)}
          >
            <PlusIcon className="size-3" />
            Custom link…
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 justify-start gap-2 text-xs text-muted-foreground"
            onClick={resetLayout}
          >
            Reset layout
          </Button>
        </div>
      </div>

      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a personal link</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="custom-name">Name</Label>
              <Input
                id="custom-name"
                value={customForm.name}
                onChange={(e) =>
                  setCustomForm({ ...customForm, name: e.target.value })
                }
                placeholder="My dashboard"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="custom-url">URL</Label>
              <Input
                id="custom-url"
                value={customForm.url}
                onChange={(e) =>
                  setCustomForm({ ...customForm, url: e.target.value })
                }
                placeholder="https://…  ({{email}} is supported)"
                className="font-mono text-xs"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Saved under <strong>Personal</strong> in the toolbox — available on
              every canvas and editable in Settings.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCustomOpen(false)}
              disabled={customBusy}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void saveCustomLink()}
              disabled={
                customBusy ||
                !customForm.name.trim() ||
                !/^https?:\/\//.test(customForm.url.trim())
              }
            >
              {customBusy ? "Saving…" : "Save link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div
        className={cn(
          "h-full w-full",
          !edgesVisible && "[&_.react-flow__edges]:hidden",
        )}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.15}
          maxZoom={2}
        >
          <Background gap={24} />
          <Controls />
          <MiniMap pannable zoomable className="!bg-muted" />
        </ReactFlow>
      </div>
    </div>
    </CanvasActiveContext.Provider>
  )
}

export function CaseCanvas(props: CaseCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  )
}
