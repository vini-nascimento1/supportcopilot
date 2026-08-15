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
  ClipboardListIcon,
  DownloadIcon,
  GlobeIcon,
  MonitorIcon,
  NetworkIcon,
  PlusIcon,
  RefreshCwIcon,
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
import { getPins, clearAllPins, geometryForSave } from "@/lib/canvas-pins"
import { broadcastCanvasRefresh } from "@/lib/canvas-refresh"
import {
  FALLBACK_TOOLS,
  groupTools,
  reconcileRestoredToolUrl,
  resolveToolUrl,
  suggestedTools,
  type CanvasTool,
} from "@/lib/canvas-tools"
import { CanvasActiveContext } from "@/components/canvas/active-context"
import { AnchorLayerContext } from "@/components/canvas/anchor-layer"
import { ToolNode, type ToolNodeData } from "@/components/canvas/tool-node"
import { SavedLayoutProvider } from "@/components/canvas/pin-button"
import {
  CaseInfoNode,
  type CaseInfoData,
} from "@/components/canvas/case-info-node"
import { NotesNode } from "@/components/canvas/notes-node"
import { MacrosNode } from "@/components/canvas/macros-node"
import { QueueNode } from "@/components/canvas/queue-node"
import { CanvasLeftSidebar } from "@/components/canvas/canvas-left-sidebar"
import {
  ConversationReplyNode,
  type ConversationReplyData,
} from "@/components/canvas/conversation-reply-node"

export interface CaseCanvasProps {
  /** Absent on the ad-hoc canvas (/canvas) */
  caseInfo?: CaseInfoData
  /** Intercom thread, rendered as a Conversation card on case canvases */
  conversation?: Pick<ConversationReplyData, "subject" | "messages">
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
    () => false
  )
}

const STORAGE_PREFIX = "fv-canvas-layout-v1:"
const nodeTypes = {
  tool: ToolNode,
  "case-info": CaseInfoNode,
  notes: NotesNode,
  macros: MacrosNode,
  queue: QueueNode,
  conversation: ConversationReplyNode,
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

// Group ordering + suggestion rules live in lib/canvas-tools.ts (testable,
// and shared with the group-name-consistency fix there — see GROUP_ORDER).

type SavedLayout = {
  nodes: Array<
    Pick<Node, "id" | "type" | "position" | "width" | "height" | "data">
  >
  edges: Edge[]
}

function toolNode(
  tool: CanvasTool,
  url: string,
  position: { x: number; y: number },
  ghost = false
): Node {
  return {
    id: `tool:${tool.id}`,
    type: "tool",
    position,
    width: 640,
    height: 520,
    // urlTemplate is kept alongside the resolved url so the canvas can
    // re-resolve it later if the agent corrects the case's email/name.
    data: { label: tool.name, icon: tool.icon, url, urlTemplate: tool.urlTemplate, ghost },
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
        width: 460,
        height: 640,
        data: {
          ...props.conversation,
          conversationId: props.caseInfo.conversationId,
        },
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
      id: "notes",
      type: "notes",
      position: { x: 0, y: 500 },
      width: 380,
      height: 180,
      data: { text: "" },
    })
    nodes.push({
      id: "macros",
      type: "macros",
      position: { x: 0, y: 710 },
      width: 380,
      height: 320,
      data: { conversationId: props.caseInfo.conversationId },
    })
    // Suggested tools by Intercom tag OR ticket keywords (Fadmin always) —
    // ghost cards: nothing loads until the agent confirms.
    suggestedTools(tools, props.caseInfo.tags, props.ticketText).forEach(
      (tool, i) => {
        const url = resolveToolUrl(tool.urlTemplate, ctx)
        if (!url) return
        const node = toolNode(tool, url, { x: 460, y: i * 580 }, true)
        nodes.push(node)
        edges.push(caseToolEdge(node.id))
      }
    )
  }
  // Ad-hoc canvases start empty — everything is added from the toolbox.
  return { nodes, edges }
}

// Guarded read of a per-case saved layout — shared by loadLayout, the
// debounced save effect (Bug 1: pinned-node geometry) and the unpin restore
// (see SavedLayoutProvider below).
function readSavedLayout(key: string): SavedLayout | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SavedLayout
    return Array.isArray(parsed?.nodes) ? parsed : null
  } catch {
    return null
  }
}

function loadLayout(key: string, props: CaseCanvasProps): SavedLayout {
  const saved = readSavedLayout(key)
  // Bug 2: `{nodes: []}` is a legitimate saved state (the agent intentionally
  // cleared the canvas), not "nothing was ever saved" — only missing/corrupt
  // storage (readSavedLayout returning null) should fall through to
  // buildDefaultLayout. For a case canvas the Case Info + Conversation cards
  // are essential context, so they're re-injected below even into an emptied
  // layout; an emptied ad-hoc canvas (no case info) stays truly empty.
  if (saved) {
    // Fresh customer context for re-resolving tool-card URLs below. Gathered
    // BEFORE mapping: the case-info node can appear after a tool node in
    // saved.nodes, and both need the same (agent-corrected-if-any) values.
    const caseInfoNode = saved.nodes.find((n) => n.type === "case-info")
    const caseInfoOverrides = (caseInfoNode?.data as Partial<CaseInfoData> | undefined)
      ?.overrides
    const urlCtx = {
      email: caseInfoOverrides?.customerEmail ?? props.caseInfo?.customerEmail,
      name: caseInfoOverrides?.customerName ?? props.caseInfo?.customerName,
    }
    // Live data (case info, reply context) must never come from storage —
    // refresh it from the server-provided props, keep saved geometry.
    const nodes = saved.nodes.map((n) => {
      if (n.type === "case-info" && props.caseInfo) {
        // Fresh Intercom data + the agent's saved corrections (overrides)
        return { ...n, data: { ...props.caseInfo, overrides: caseInfoOverrides } }
      }
      if (
        n.type === "conversation" &&
        props.conversation &&
        props.caseInfo
      ) {
        return {
          ...n,
          data: {
            ...props.conversation,
            conversationId: props.caseInfo.conversationId,
            playbookId: (n.data as Partial<ConversationReplyData>)
              .playbookId,
            playbookName: (n.data as Partial<ConversationReplyData>)
              .playbookName,
            copilotTranscript: (n.data as Partial<ConversationReplyData>)
              .copilotTranscript,
          },
        }
      }
      if (n.type === "macros" && props.caseInfo) {
        return {
          ...n,
          data: { conversationId: props.caseInfo.conversationId },
        }
      }
      if (n.type === "tool") {
        // A restored tool card keeps last session's url as-is otherwise —
        // if the customer's email/name changed since then this re-resolves
        // it (ghost cards swap url directly, loaded cards get a pendingUrl
        // banner instead of being yanked to a new page).
        const data = n.data as ToolNodeData
        const patch = reconcileRestoredToolUrl(data, urlCtx)
        if (!patch) return n
        return { ...n, data: { ...data, ...patch } }
      }
      return n
    })
    const nodesWithoutRetired = nodes.filter(
      (n) => n.type !== "draft" && n.type !== "ai"
    )
    // Case Info is essential context for a case canvas — reinject it if an
    // emptied (or pre-case-info) saved layout doesn't have one (Bug 2).
    if (
      props.caseInfo &&
      !nodesWithoutRetired.some((n) => n.type === "case-info")
    ) {
      nodesWithoutRetired.push({
        id: "case-info",
        type: "case-info",
        position: { x: 0, y: 0 },
        width: 320,
        height: 460,
        data: props.caseInfo,
      })
    }
    // Layouts saved before the Conversation card existed: inject it
    if (
      props.conversation &&
      props.caseInfo &&
      !nodesWithoutRetired.some((n) => n.type === "conversation")
    ) {
      nodesWithoutRetired.unshift({
        id: "conversation",
        type: "conversation",
        position: { x: -480, y: 0 },
        width: 460,
        height: 640,
        data: {
          ...props.conversation,
          conversationId: props.caseInfo.conversationId,
        },
      })
    }
    // Layouts saved before the Macros card existed: inject it
    if (
      props.caseInfo &&
      !nodesWithoutRetired.some((n) => n.type === "macros")
    ) {
      nodesWithoutRetired.push({
        id: "macros",
        type: "macros",
        position: { x: 0, y: 960 },
        width: 380,
        height: 320,
        data: { conversationId: props.caseInfo.conversationId },
      })
    }
    return {
      nodes: nodesWithoutRetired as Node[],
      edges: saved.edges ?? [],
    }
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

// Bug 1: what a node actually needs persisted to localStorage. loadLayout
// above always re-seeds conversation/case-info/macros data fresh from props
// at load time, keeping only the few fields listed here from storage — so
// saving the rest (the full Intercom `messages` thread, customer contact
// details, etc.) would be pure PII sitting in localStorage plus wasted quota
// across up to 12 tabs, for no gain. Tool/notes/queue nodes keep their full
// data: notes content and tool-card url state ARE the persisted value, and
// loadLayout doesn't rebuild them from anything else.
function dataForSave(node: {
  type?: string
  data: Record<string, unknown>
}): Record<string, unknown> {
  switch (node.type) {
    case "conversation": {
      const d = node.data as Partial<ConversationReplyData>
      return {
        playbookId: d.playbookId,
        playbookName: d.playbookName,
        copilotTranscript: d.copilotTranscript,
      }
    }
    case "case-info": {
      const d = node.data as Partial<CaseInfoData>
      return { overrides: d.overrides }
    }
    case "macros": {
      const d = node.data as { conversationId?: string }
      return { conversationId: d.conversationId }
    }
    default:
      return node.data
  }
}

function CanvasInner(props: CaseCanvasProps) {
  const host = getCanvasHost()
  const active = props.active ?? true
  const multiplexed = props.multiplexed ?? false
  const storageKey = STORAGE_PREFIX + props.storageKey
  const initial = useMemo(
    () => applyPins(loadLayout(storageKey, props)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storageKey]
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

  // Keep tool cards (Fadmin, ONDATO, MassPay…) in sync when the agent
  // corrects the case's email/name in the Case Info card. Without this,
  // already-built tool cards would keep pointing at whatever Intercom had on
  // file at the moment the canvas was opened, forever — even after the agent
  // fixes a wrong/secondary email.
  const caseInfoData = nodes.find((n) => n.type === "case-info")?.data as
    | CaseInfoData
    | undefined
  const resolvedEmail =
    caseInfoData?.overrides?.customerEmail ?? caseInfoData?.customerEmail ?? null
  const resolvedName =
    caseInfoData?.overrides?.customerName ?? caseInfoData?.customerName ?? null
  const prevResolvedRef = useRef<{ email: string | null; name: string | null } | null>(
    null
  )
  useEffect(() => {
    const prev = prevResolvedRef.current
    prevResolvedRef.current = { email: resolvedEmail, name: resolvedName }
    // First render: tool URLs were already built with these values — nothing
    // to reconcile yet.
    if (!prev) return
    if (prev.email === resolvedEmail && prev.name === resolvedName) return

    let changed = 0
    setNodes((nds) =>
      nds.map((n) => {
        if (n.type !== "tool") return n
        const data = n.data as ToolNodeData
        if (!data.urlTemplate) return n
        const freshUrl = resolveToolUrl(data.urlTemplate, {
          email: resolvedEmail,
          name: resolvedName,
        })
        if (!freshUrl || freshUrl === data.url) return n
        changed++
        // Ghost (unopened) cards have nothing loaded yet — safe to just swap.
        // An already-open card is never yanked to a new page automatically;
        // ToolNode shows a one-click "Refresh" banner instead.
        return {
          ...n,
          data: data.ghost
            ? { ...data, url: freshUrl }
            : { ...data, pendingUrl: freshUrl },
        }
      })
    )
    if (changed > 0) {
      toast.info(
        `Case ${prev.email !== resolvedEmail ? "email" : "name"} updated — ${changed} tool card${changed === 1 ? "" : "s"} ${changed === 1 ? "has" : "have"} a refreshed link ready.`
      )
    }
    // Only the resolved values should retrigger this — setNodes/toast are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedEmail, resolvedName])

  // Debounced persistence of geometry + notes + edges.
  //
  // Bug fix: a pinned node's live position/width/height is the GLOBAL pin
  // geometry (applyPins overwrote it at mount, above) — saving that back
  // verbatim would permanently overwrite this case's own layout the moment
  // ANY pin exists. So for currently-pinned nodes we persist the geometry
  // from the PREVIOUSLY saved layout instead of the node's current
  // (pin-imposed) values, falling back to current when this case never saved
  // that node before (e.g. added then pinned in the same session).
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    // Bug 7: on the web build (no desktop host) the canvas renders a
    // "desktop only" gate — nothing here is visible or editable, so there's
    // nothing worth persisting. Every mounted pane would otherwise still
    // write a layout on every node/edge change for a screen nobody sees.
    if (!host) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      let pins: ReturnType<typeof getPins> = {}
      try {
        pins = getPins()
      } catch {
        // SSR — no pins
      }
      const previousById = new Map(
        (readSavedLayout(storageKey)?.nodes ?? []).map((n) => [n.id, n])
      )
      const payload: SavedLayout = {
        nodes: nodes.map(({ id, type, position, width, height, data }) => {
          const prev = previousById.get(id)
          const geom = geometryForSave(
            id in pins,
            { position, width, height },
            prev && { position: prev.position, width: prev.width, height: prev.height }
          )
          return {
            id,
            type,
            position: geom.position,
            width: geom.width,
            height: geom.height,
            data: dataForSave({ type, data }),
          }
        }),
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
  }, [nodes, edges, storageKey, host])

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
          eds
        )
      ),
    [setEdges]
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
        const maxX = Math.max(
          0,
          ...nds.map((n) => n.position.x + (n.width ?? 0))
        )
        // Explicitly added by the agent → loads immediately (not a ghost)
        return [...nds, toolNode(tool, url, { x: maxX + 60, y: 0 })]
      })
      if (props.caseInfo) {
        setEdges((eds) =>
          eds.some((e) => e.id === `e:case:tool:${tool.id}`)
            ? eds
            : [...eds, caseToolEdge(`tool:${tool.id}`)]
        )
      }
    },
    [nodes, props.caseInfo, setNodes, setEdges]
  )

  // Command palette → "Open <tool> on canvas"
  const toolsRef = useRef(props.tools ?? FALLBACK_TOOLS)
  useEffect(() => {
    toolsRef.current = props.tools ?? FALLBACK_TOOLS
  }, [props.tools])
  // Bug 6: this listener fires "add this tool" — every mounted keep-alive
  // pane in the workspace host subscribes to the same window event, so a
  // hidden pane must not react to it or the card gets added everywhere at
  // once. Gated on `active`, same as every other cross-pane subscriber below.
  useEffect(() => {
    if (!active) return
    const handler = (e: Event) => {
      const toolId = (e as CustomEvent<{ toolId: string }>).detail?.toolId
      const tool = toolsRef.current.find((t) => t.id === toolId)
      if (tool) addTool(tool)
    }
    window.addEventListener("canvas-add-tool", handler)
    return () => window.removeEventListener("canvas-add-tool", handler)
  }, [addTool, active])

  // Bug 4: resetLayout (below) needs the LATEST props (tools/caseInfo/
  // conversation may have changed since mount) — a plain closure over `props`
  // would keep rebuilding from the mount-time snapshot forever. Same ref
  // pattern as toolsRef above, but for the whole props object.
  const propsRef = useRef(props)
  useEffect(() => {
    propsRef.current = props
  })

  const addNote = useCallback(() => {
    setNodes((nds) => [
      ...nds,
      {
        // Bug 3: `notes:${nds.length}-${notesCount}` collided after a delete
        // (e.g. delete note 0 of 2, then add — recomputes the same id as an
        // existing node). A random suffix can't collide the same way.
        id: `notes:${Math.random().toString(36).slice(2, 10)}`,
        type: "notes",
        position: { x: 60 + nds.length * 20, y: 60 + nds.length * 20 },
        width: 300,
        height: 180,
        data: { text: "" },
      },
    ])
  }, [setNodes])

  // Singleton cards (one queue per canvas)
  const addSingleton = useCallback(
    (type: "queue") => {
      setNodes((nds) => {
        if (nds.some((n) => n.id === type)) return nds
        const maxX = Math.max(
          0,
          ...nds.map((n) => n.position.x + (n.width ?? 0))
        )
        return [
          ...nds,
          {
            id: type,
            type,
            position: { x: maxX + 60, y: 0 },
            width: 300,
            height: 420,
            data: {},
          },
        ]
      })
    },
    [setNodes]
  )

  const router = useRouter()

  const deletePersonalLink = useCallback(
    async (tool: CanvasTool) => {
      if (!window.confirm(`Delete "${tool.name}" from your Personal tools?`))
        return
      const res = await fetch(`/api/case-tools/${tool.id}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        toast.error("Couldn't delete the link")
        return
      }
      toast.success("Link deleted")
      router.refresh()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
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
      const { error } = await res
        .json()
        .catch(() => ({ error: res.statusText }))
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
    // Bug 4: rebuild from the latest props (propsRef, not the stale `props`
    // closure) and run the result through applyPins — otherwise a pinned
    // node would come back draggable at its non-pinned default position/size
    // instead of its global pinned geometry.
    const fresh = applyPins(buildDefaultLayout(propsRef.current))
    setNodes(fresh.nodes)
    setEdges(fresh.edges)
    setTimeout(() => fitView({ padding: 0.1 }), 50)
  }, [storageKey, setNodes, setEdges, fitView])

  // Lets PinButton put a card back where THIS case had it on unpin, instead
  // of leaving it at the pin's global spot (see SavedLayoutProvider below).
  const getSavedGeometry = useCallback(
    (nodeId: string) => {
      const node = readSavedLayout(storageKey)?.nodes.find((n) => n.id === nodeId)
      if (!node) return undefined
      return { position: node.position, width: node.width, height: node.height }
    },
    [storageKey]
  )

  // Live refresh — the conversation/case-info cards are seeded once at mount
  // (loadLayout) and don't follow props, so a reopened or closed ticket would
  // otherwise stay stale. Re-fetch the thread and patch just those two cards,
  // preserving the agent's saved overrides and all other cards' state.
  // Portal target for pinned tool cards — sits outside React Flow's
  // transformed viewport so anchored cards don't move/resize on pan/zoom.
  const [anchorLayerEl, setAnchorLayerEl] = useState<HTMLDivElement | null>(
    null
  )

  const conversationId = props.caseInfo?.conversationId
  const [refreshing, setRefreshing] = useState(false)
  const refreshConversation = useCallback(async () => {
    if (!conversationId) return
    const res = await fetch(
      `/api/canvas/conversation?id=${encodeURIComponent(conversationId)}`
    )
    if (!res.ok) throw new Error(`Refresh failed (${res.status})`)
    const fresh = (await res.json()) as {
      caseInfo: CaseInfoData
      conversation: Pick<ConversationReplyData, "subject" | "messages">
    }
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === "conversation") {
          // playbookId/playbookName come from the separate async match fetch
          // (not props — see the effect below), so carry over whatever the
          // card already has rather than resetting it on every refresh.
          const prev = n.data as Partial<ConversationReplyData>
          return {
            ...n,
            data: {
              ...fresh.conversation,
              conversationId,
              playbookId: prev.playbookId,
              playbookName: prev.playbookName,
              copilotTranscript: prev.copilotTranscript,
            },
          }
        }
        if (n.id === "case-info") {
          const overrides = (n.data as Partial<CaseInfoData>)?.overrides
          return { ...n, data: { ...fresh.caseInfo, overrides } }
        }
        return n
      })
    )
  }, [conversationId, setNodes])

  // Playbook match banner — fetched separately from the initial render (see
  // /api/canvas/playbook-match) because it's a live LLM classifier call.
  // Patches into the already-mounted conversation card once it resolves,
  // instead of blocking the canvas from painting.
  const ticketText = props.ticketText
  useEffect(() => {
    // Bug 7: this hits a live LLM classifier — skip it on the web build
    // (no desktop host), where the canvas is behind the download gate and
    // nobody can see the result anyway.
    if (!host || !conversationId || !ticketText) return
    let cancelled = false
    fetch("/api/canvas/playbook-match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketText }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((match: { playbookId?: string; playbookName?: string } | null) => {
        if (cancelled || !match?.playbookId) return
        setNodes((nds) =>
          nds.map((n) =>
            n.id === "conversation"
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    playbookId: match.playbookId,
                    playbookName: match.playbookName,
                  },
                }
              : n
          )
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [conversationId, ticketText, setNodes, host])

  const manualRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await refreshConversation()
      broadcastCanvasRefresh() // also nudge the live queue cards
    } catch {
      toast.error("Couldn't refresh — try again in a moment")
    } finally {
      setRefreshing(false)
    }
  }, [refreshConversation])

  // Auto-refresh while this pane is on screen (~30s), and immediately when a
  // backgrounded workspace pane is brought back to the foreground (it may have
  // gone stale while another ticket was worked). The first foreground after
  // mount is already fresh from the server, so it's skipped.
  const prevActive = useRef(active)
  useEffect(() => {
    // Bug 7: on the web build (no desktop host) this pane is only the
    // download gate — polling Intercom every 30s for a view nobody can see
    // is pure waste (and load on Intercom for every mounted workspace pane).
    if (!host || !conversationId) return
    if (active && !prevActive.current)
      void refreshConversation().catch(() => {})
    prevActive.current = active
    if (!active) return
    const t = setInterval(
      () => void refreshConversation().catch(() => {}),
      30_000
    )
    return () => clearInterval(t)
  }, [active, conversationId, refreshConversation, host])

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
    <SavedLayoutProvider value={getSavedGeometry}>
    <CanvasActiveContext.Provider value={active}>
      {/* data-canvas-pane marks the safe region for native tool views — they're
        clipped to it (minus the docked chrome below) so they never overlay the
        sidebars or toolbox. See lib/canvas-bounds.ts. overflow-hidden matters
        here specifically: a pinned card portals in via anchor-layer at a
        screen rect that can end up a few px past this pane's edge (stale
        measurement, a resize mid-drag, etc.) — without a clip here that
        oversized absolute-positioned child pushes the WHOLE window into
        scrolling, not just this pane. */}
      <div data-canvas-pane className="relative h-full w-full overflow-hidden">
        <CanvasLeftSidebar />

        {/* Toolbox — right-docked chrome; native tool views are clipped to its left edge */}
        <div
          data-canvas-chrome="right"
          className="absolute top-4 right-4 z-10 flex max-h-[calc(100%-6rem)] flex-col items-end gap-1.5"
        >
          <div className="flex items-center gap-1.5">
            {conversationId && (
              <button
                onClick={() => void manualRefresh()}
                disabled={refreshing}
                title="Refresh conversation & queue"
                className="flex size-6 items-center justify-center rounded-md border bg-card/95 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground disabled:opacity-50"
              >
                <RefreshCwIcon
                  className={cn("size-3.5", refreshing && "animate-spin")}
                />
              </button>
            )}
            <button
              onClick={toggleEdges}
              title={edgesVisible ? "Hide link wires" : "Show link wires"}
              className={cn(
                "flex size-6 items-center justify-center rounded-md border bg-card/95 shadow-sm backdrop-blur transition-colors",
                edgesVisible
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
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
            <span className="px-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              Cards
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 justify-start gap-2 text-xs"
              onClick={addNote}
            >
              <StickyNoteIcon className="size-3" />
              Note
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 justify-start gap-2 text-xs"
              onClick={() => addSingleton("queue")}
            >
              <ClipboardListIcon className="size-3" />
              Queue
            </Button>

            {groupTools(props.tools ?? FALLBACK_TOOLS).map(([group, tools]) => (
              <div key={group} className="flex flex-col gap-1">
                <Separator className="my-1" />
                <span className="px-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
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
                        className="shrink-0 px-1 text-muted-foreground opacity-0 transition-opacity group-hover/tool:opacity-100 hover:text-destructive"
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
            <Button
              variant="ghost"
              size="sm"
              className="h-7 justify-start gap-2 text-xs text-muted-foreground"
              title="Pinned cards keep one fixed position/size across every canvas — use this if one ever looks wrong or covers the screen"
              onClick={() => {
                if (window.confirm("Unpin every pinned tool card? This clears their fixed position everywhere, not just this canvas.")) {
                  clearAllPins()
                }
              }}
            >
              Unpin all tool cards
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
                Saved under <strong>Personal</strong> in the toolbox — available
                on every canvas and editable in Settings.
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

        <AnchorLayerContext.Provider value={anchorLayerEl}>
          <div
            className={cn(
              "h-full w-full",
              !edgesVisible && "canvas-edges-hidden"
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
          {/* Pinned tool cards portal in here — outside the pan/zoom transform
              above, so they stay put on screen (see ToolNode + canvas-pins). */}
          <div
            ref={setAnchorLayerEl}
            className="pointer-events-none absolute inset-0 z-[4]"
          />
        </AnchorLayerContext.Provider>
      </div>
    </CanvasActiveContext.Provider>
    </SavedLayoutProvider>
  )
}

export function CaseCanvas(props: CaseCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  )
}
