"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  HomeIcon,
  ClipboardListIcon,
  InboxIcon,
  MoreHorizontalIcon,
  MailIcon,
  MessageSquareIcon,
  BookOpenIcon,
  ZapIcon,
  BarChart3Icon,
  MegaphoneIcon,
  SettingsIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ChangelogDialog } from "@/components/changelog-dialog"

interface Props {
  isManager?: boolean
}

const primaryItems = [
  { label: "Home", icon: HomeIcon, href: "/" },
  { label: "Cases", icon: ClipboardListIcon, href: "/cases" },
  // /queue is a placeholder until workstream E lifts the queue panel out of
  // Canvas; it links to /cases for now.
  { label: "Queue", icon: InboxIcon, href: "/cases" },
]

/**
 * Bottom tab bar shown below the 768px breakpoint (see hooks/use-mobile.ts).
 * Canvas is deliberately absent — it needs desktop screen space and (for the
 * full experience) the desktop shell's embedded tool views. Hidden purely via
 * `md:hidden` so there's no client/server render mismatch to manage.
 */
export function MobileNav({ isManager }: Props) {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)
  const [changelogOpen, setChangelogOpen] = useState(false)

  // Order matches the plan: Gmail, Slack, Playbooks, Automation, Metrics (if
  // manager), New Features, Settings. New Features opens the changelog
  // dialog instead of navigating, so it's rendered separately below.
  const moreLinks = [
    { label: "Gmail", icon: MailIcon, href: "/gmail" },
    { label: "Slack", icon: MessageSquareIcon, href: "/slack" },
    { label: "Playbooks", icon: BookOpenIcon, href: "/playbooks" },
    { label: "Automation", icon: ZapIcon, href: "/automation" },
    ...(isManager ? [{ label: "Metrics", icon: BarChart3Icon, href: "/metrics" }] : []),
  ]

  return (
    <>
      <nav
        // "bottom" isn't a dock lib/canvas-bounds.ts clips against today (it
        // only insets "left"/"right"-docked chrome) — Canvas is out of scope
        // on mobile viewports (see the plan) so this never needs to clip a
        // native tool view in practice. Marked anyway for consistency with
        // the other fixed overlays (components/ai-chat.tsx,
        // components/canvas/canvas-left-sidebar.tsx) and in case that changes.
        data-canvas-chrome="bottom"
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 flex h-14 items-stretch border-t bg-background md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {primaryItems.map((item) => {
          const isActive =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
          return (
            <Link
              key={item.label}
              href={item.href}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              <item.icon className="size-5" />
              {item.label}
            </Link>
          )
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted-foreground"
        >
          <MoreHorizontalIcon className="size-5" />
          More
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="max-h-[80vh]">
          <SheetHeader>
            <SheetTitle>More</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-1 px-4 pb-6">
            {moreLinks.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className="flex items-center gap-3 rounded-md px-2 py-2.5 text-sm font-medium hover:bg-accent"
              >
                <item.icon className="size-4 text-muted-foreground" />
                {item.label}
              </Link>
            ))}
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false)
                setChangelogOpen(true)
              }}
              className="flex items-center gap-3 rounded-md px-2 py-2.5 text-left text-sm font-medium hover:bg-accent"
            >
              <MegaphoneIcon className="size-4 text-muted-foreground" />
              New Features
            </button>
            <Link
              href="/settings"
              onClick={() => setMoreOpen(false)}
              className="flex items-center gap-3 rounded-md px-2 py-2.5 text-sm font-medium hover:bg-accent"
            >
              <SettingsIcon className="size-4 text-muted-foreground" />
              Settings
            </Link>
          </div>
        </SheetContent>
      </Sheet>

      <ChangelogDialog open={changelogOpen} onClose={() => setChangelogOpen(false)} />
    </>
  )
}
