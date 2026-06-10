"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  MessageSquareIcon,
  MailIcon,
  BookOpenIcon,
  RefreshCcwIcon,
  LayoutPanelTopIcon,
  CommandIcon,
  ArrowUpDownIcon,
} from "lucide-react"
import { Input } from "@/components/ui/input"

type CommandItem = {
  id: string
  label: string
  icon: typeof MessageSquareIcon
  keywords: string[]
  action: ((router: ReturnType<typeof useRouter>) => void) | null // null = info-only
}

const ITEMS: CommandItem[] = [
  {
    id: "goto-intercom",
    label: "Open next case",
    icon: MessageSquareIcon,
    keywords: ["case", "intercom", "queue"],
    action: () => {
      const appId =
        document.documentElement.dataset.intercomAppId ?? "yzo8ff0f"
      window.open(`https://app.intercom.com/a/inbox/${appId}/inbox/all`, "_blank")
    },
  },
  {
    id: "goto-playbook",
    label: "Jump to Playbook",
    icon: BookOpenIcon,
    keywords: ["playbook", "kb", "guide", "article"],
    action: (router) => router.push("/playbooks"),
  },
  {
    id: "goto-gmail",
    label: "Jump to Gmail",
    icon: MailIcon,
    keywords: ["email", "mail", "inbox"],
    action: (router) => router.push("/gmail"),
  },
  {
    id: "goto-slack",
    label: "Jump to Slack",
    icon: MessageSquareIcon,
    keywords: ["slack", "channel", "dm"],
    action: (router) => router.push("/slack"),
  },
  {
    id: "refresh-all",
    label: "Refresh all data",
    icon: RefreshCcwIcon,
    keywords: ["refresh", "reload", "sync", "update"],
    action: () => {
      window.dispatchEvent(new CustomEvent("refresh-intercom"))
      window.dispatchEvent(new CustomEvent("refresh-gmail"))
    },
  },
  {
    id: "reset-layout",
    label: "Reset dashboard layout",
    icon: LayoutPanelTopIcon,
    keywords: ["reset", "layout", "grid", "arrange", "default"],
    action: () => window.dispatchEvent(new CustomEvent("reset-dashboard-layout")),
  },
  {
    id: "jump-cases",
    label: "Jump between cases (j/k)",
    icon: ArrowUpDownIcon,
    keywords: ["navigate", "case", "keyboard", "up", "down"],
    action: null, // Info-only
  },
]

/**
 * Cmd-K command palette.
 * Renders nothing when closed — activated via Cmd-K / Ctrl-K.
 */
export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Reset query on close — inline in the close handler, not a separate effect.
  function close() {
    setOpen(false)
    setQuery("")
    setActiveIndex(0)
  }

  // Toggle palette on Cmd-K / Ctrl-K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  // Focus the input when the palette opens.
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const filtered = query
    ? ITEMS.filter(
        (item) =>
          item.label.toLowerCase().includes(query.toLowerCase()) ||
          item.keywords.some((k) => k.toLowerCase().includes(query.toLowerCase())),
      )
    : ITEMS

  // Keep activeIndex in bounds when filter changes (synchronous, no effect needed)
  if (activeIndex >= filtered.length) {
    setActiveIndex(Math.max(0, filtered.length - 1))
  }

  function execute(item: CommandItem) {
    item.action?.(router)
    close()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "Escape":
        close()
        break
      case "ArrowDown":
        e.preventDefault()
        setActiveIndex((prev) => (prev + 1) % Math.max(filtered.length, 1))
        break
      case "ArrowUp":
        e.preventDefault()
        setActiveIndex((prev) => (prev - 1 + filtered.length) % Math.max(filtered.length, 1))
        break
      case "Enter":
        e.preventDefault()
        if (filtered[activeIndex]) execute(filtered[activeIndex])
        break
    }
  }

  return open ? (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" />

      {/* Palette */}
      <div
        className="relative z-10 w-full max-w-lg rounded-xl bg-popover p-1 ring-1 ring-foreground/10 shadow-lg shadow-black/5 animate-in fade-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2.5">
          <CommandIcon className="size-4 shrink-0 text-muted-foreground/60" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActiveIndex(0)
            }}
            placeholder="Type a command or search…"
            className="flex-1 border-0 bg-transparent shadow-none placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:ring-offset-0"
            onKeyDown={onKeyDown}
          />
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-72 overflow-y-auto py-1" role="listbox">
          {filtered.map((item, i) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={i === activeIndex}
              onClick={() => execute(item)}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-foreground focus-visible:outline-none aria-disabled:opacity-50 aria-disabled:pointer-events-none ${
                i === activeIndex ? "bg-accent" : "hover:bg-accent focus-visible:bg-accent"
              }`}
              aria-disabled={!item.action || undefined}
            >
              <item.icon className="size-4 shrink-0 text-muted-foreground/70" />
              <span>{item.label}</span>
              {!item.action && (
                <span className="ml-auto text-xs text-muted-foreground/40">
                  Info
                </span>
              )}
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No results for &ldquo;{query}&rdquo;
            </p>
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center gap-3 border-t border-border/40 px-3 py-1.5">
          <span className="text-xs text-muted-foreground/50">
            <kbd className="rounded-sm bg-muted px-1 py-0.5 text-[10px] font-medium">↑↓</kbd> navigate
          </span>
          <span className="text-xs text-muted-foreground/50">
            <kbd className="rounded-sm bg-muted px-1 py-0.5 text-[10px] font-medium">⏎</kbd> select
          </span>
          <span className="text-xs text-muted-foreground/50">
            <kbd className="rounded-sm bg-muted px-1 py-0.5 text-[10px] font-medium">esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  ) : null
}
