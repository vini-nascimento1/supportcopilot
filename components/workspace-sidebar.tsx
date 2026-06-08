"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BookOpenIcon,
  ClipboardListIcon,
  LifeBuoyIcon,
  LogOutIcon,
  MailIcon,
  MessageSquareIcon,
  BarChart3Icon,
  MegaphoneIcon,
  SettingsIcon,
  ZapIcon,
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

const navItems = [
  { label: "Dashboard", icon: LifeBuoyIcon, href: "/" },
  { label: "Cases", icon: ClipboardListIcon, href: "/cases" },
  { label: "Gmail", icon: MailIcon, href: "/gmail" },
  { label: "Slack", icon: MessageSquareIcon, href: "/slack" },
  { label: "Playbooks", icon: BookOpenIcon, href: "/playbooks" },
  { label: "Metrics", icon: BarChart3Icon, href: "/metrics" },
  { label: "Automation", icon: ZapIcon, href: "/automation" },
  { label: "Settings", icon: SettingsIcon, href: "/settings" },
]

interface Props {
  userEmail: string | null
}

export function WorkspaceSidebar({ userEmail }: Props) {
  const pathname = usePathname()
  const initial = userEmail ? userEmail[0]?.toUpperCase() : "?"
  const [changelogOpen, setChangelogOpen] = useState(false)

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
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname === item.href || pathname.startsWith(item.href + "/")
                return (
                  <SidebarMenuItem key={item.label}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}

              {/* Novidades — opens changelog dialog instead of navigating */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={false}
                  onClick={() => setChangelogOpen(true)}
                >
                  <button className="w-full">
                    <MegaphoneIcon />
                    <span>Novidades</span>
                  </button>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <ChangelogDialog open={changelogOpen} onClose={() => setChangelogOpen(false)} />

      <SidebarFooter>
        <div className="flex items-center gap-3 px-2 py-2">
          <Link
            href="/settings"
            className="flex min-w-0 flex-1 items-center gap-3 rounded-md p-1 -m-1 transition-colors hover:bg-muted"
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
              {initial}
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-xs font-medium">
                {userEmail ?? "Not signed in"}
              </span>
              <span className="text-[10px] text-muted-foreground">Fanvue Support</span>
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
