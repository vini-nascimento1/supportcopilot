"use client"

import { usePathname } from "next/navigation"

import { AIChat } from "@/components/ai-chat"
import { CommandPalette } from "@/components/command-palette"
import { NotificationBell } from "@/components/notifications/notification-bell"
import { NotificationToasts } from "@/components/notifications/notification-toasts"

// The root layout wraps every route, including /login. These floating widgets
// are for signed-in agents only (the AI chat, palette and notifications all hit
// authenticated APIs), so they are skipped on the public login page rather than
// rendered over the sign-in button. proxy.ts is what actually gates the routes;
// this is purely so the login page stays clean.
export function SignedInOverlays() {
  const pathname = usePathname()
  if (pathname === "/login") return null
  return (
    <>
      <AIChat />
      <CommandPalette />
      <NotificationBell />
      <NotificationToasts />
    </>
  )
}
