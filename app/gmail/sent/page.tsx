import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { WorkspaceLayout } from "@/components/workspace-layout"
import { HistoryIcon } from "lucide-react"
import { getAgentTokens } from "@/lib/auth"
import SentContent from "./sent-content"

export const dynamic = "force-dynamic"

export default async function SentPage() {
  const { email } = await getAgentTokens()
  return (
    <WorkspaceLayout>
      <header className="flex min-h-14 items-center gap-3 border-b px-4 lg:px-6">
        <SidebarTrigger />
        <Separator orientation="vertical" className="min-h-6" />
        <HistoryIcon className="size-4 text-muted-foreground" />
        <h1 className="text-sm font-semibold">Sent Tracker</h1>
      </header>
      <SentContent currentEmail={email ?? null} />
    </WorkspaceLayout>
  )
}
