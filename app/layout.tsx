import "@fontsource-variable/jetbrains-mono"
import "@fontsource-variable/instrument-sans"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { AIChat } from "@/components/ai-chat"
import { CommandPalette } from "@/components/command-palette"
import { UpdateBanner } from "@/components/update-banner"
import { NotificationBell } from "@/components/notifications/notification-bell"
import { NotificationToasts } from "@/components/notifications/notification-toasts"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { SpeedInsights } from "@vercel/speed-insights/next"
import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Fanvue Support Copilot",
  description: "Your AI-powered support dashboard",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className="font-sans antialiased"
    >
      <body suppressHydrationWarning>
        <ThemeProvider>
          <TooltipProvider>
            {children}
            <Toaster />
            <SpeedInsights />
            <UpdateBanner />
            <AIChat />
            <CommandPalette />
            <NotificationBell />
            <NotificationToasts />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
