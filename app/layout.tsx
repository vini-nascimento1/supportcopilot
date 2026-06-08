import "@fontsource-variable/jetbrains-mono"
import "@fontsource-variable/instrument-sans"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { AIChat } from "@/components/ai-chat"
import { UpdateBanner } from "@/components/update-banner"
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
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
