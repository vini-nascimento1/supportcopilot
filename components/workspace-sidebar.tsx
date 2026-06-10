"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BookOpenIcon,
  ClipboardListIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LifeBuoyIcon,
  LogOutIcon,
  MailIcon,
  MessageSquareIcon,
  BarChart3Icon,
  MegaphoneIcon,
  SettingsIcon,
  ZapIcon,
  SendIcon,
  FileTextIcon,
  HistoryIcon,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { ChangelogDialog } from "@/components/changelog-dialog"

const workspaceItems = [
  { label: "Dashboard", icon: LifeBuoyIcon, href: "/" },
  { label: "Cases", icon: ClipboardListIcon, href: "/cases" },
  { label: "Gmail", icon: MailIcon, href: "/gmail" },
  { label: "Slack", icon: MessageSquareIcon, href: "/slack" },
  { label: "Playbooks", icon: BookOpenIcon, href: "/playbooks" },
  { label: "Metrics", icon: BarChart3Icon, href: "/metrics" },
  { label: "Automation", icon: ZapIcon, href: "/automation" },
]

interface Props {
  userEmail: string | null
  avatarUrl: string | null
  isGmailTemplateUser?: boolean
  isManager?: boolean
}

export function WorkspaceSidebar({ userEmail, avatarUrl, isGmailTemplateUser, isManager }: Props) {
  const pathname = usePathname()
  const initial = userEmail ? userEmail[0]?.toUpperCase() : "?"
  const [changelogOpen, setChangelogOpen] = useState(false)
  const [gmailExpanded, setGmailExpanded] = useState(false)

  const visibleItems = workspaceItems.filter(
    (item) => item.label !== "Metrics" || isManager
  )

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border">
            <Image
              src="/fanvue-logo.png"
              alt="Fanvue"
              width={36}
              height={36}
              className="size-full object-cover"
            />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">Fanvue Support</span>
            <span className="truncate text-xs text-muted-foreground">Copilot</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {/* ── Workspace ──────────────────────────────────────────────────── */}
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname === item.href || pathname.startsWith(item.href + "/")
                const isGmail = item.label === "Gmail"
                return (
                  <SidebarMenuItem key={item.label}>
                    <div className="flex items-center">
                      <SidebarMenuButton asChild isActive={isActive} className="flex-1">
                        <Link href={item.href}>
                          <item.icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                      {isGmail && isGmailTemplateUser && (
                        <button
                          onClick={() => setGmailExpanded(!gmailExpanded)}
                          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors mr-1"
                          title={gmailExpanded ? "Collapse" : "Expand"}
                        >
                          {gmailExpanded ? (
                            <ChevronDownIcon className="size-3.5" />
                          ) : (
                            <ChevronRightIcon className="size-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                    {isGmail && isGmailTemplateUser && gmailExpanded && (
                      <SidebarMenu className="mt-0.5 gap-0 pl-4">
                        {[
                          { label: "Quick Send", icon: SendIcon, href: "/gmail/quick-send" },
                          { label: "Templates", icon: FileTextIcon, href: "/gmail/templates" },
                          { label: "Sent", icon: HistoryIcon, href: "/gmail/sent" },
                        ].map((sub) => {
                          const subActive = pathname.startsWith(sub.href)
                          return (
                            <SidebarMenuItem key={sub.label}>
                              <SidebarMenuButton asChild isActive={subActive} size="sm">
                                <Link href={sub.href}>
                                  <sub.icon />
                                  <span>{sub.label}</span>
                                </Link>
                              </SidebarMenuButton>
                            </SidebarMenuItem>
                          )
                        })}
                      </SidebarMenu>
                    )}
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* ── Support ────────────────────────────────────────────────────── */}
        <SidebarGroup>
          <SidebarGroupLabel>Support</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/settings"}>
                  <Link href="/settings">
                    <SettingsIcon />
                    <span>Settings</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={false}
                  onClick={() => setChangelogOpen(true)}
                >
                  <button className="w-full">
                    <MegaphoneIcon />
                    <span>New Features</span>
                  </button>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <ChangelogDialog open={changelogOpen} onClose={() => setChangelogOpen(false)} />

      {/* ── User profile ────────────────────────────────────────────────── */}
      <SidebarFooter>
        <div className="flex items-center gap-3 px-2 py-2">
          <Link
            href="/settings"
            className="flex min-w-0 flex-1 items-center gap-3 rounded-md p-1 -m-1 transition-colors hover:bg-muted"
          >
            <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold">
              {avatarUrl ? (
                <Image
                  src={avatarUrl}
                  alt=""
                  width={32}
                  height={32}
                  className="size-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                initial
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-xs font-medium">
                {userEmail ?? "Not signed in"}
              </span>
              <span className="text-xs text-muted-foreground">Fanvue Support</span>
            </div>
          </Link>
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              title="Sign out"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <LogOutIcon className="size-3.5" />
            </button>
          </form>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
