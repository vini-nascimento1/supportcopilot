import { getAgentTokens } from "@/lib/auth"
import { getCustomerFacingIdentity } from "@/lib/agent-identity"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { WorkspaceLayout } from "@/components/workspace-layout"
import { SendIcon } from "lucide-react"
import QuickSendForm from "./quick-send-form"

export const dynamic = "force-dynamic"

export default async function QuickSendPage() {
  const tokens = await getAgentTokens()
  // {{agentname}} in a quick-send template goes straight into an email a
  // customer or creator reads — resolve it from agents.agent_name, never
  // tokens.name (that's the internal display name).
  const { agentName } = await getCustomerFacingIdentity(tokens.email)

  return (
    <WorkspaceLayout>
      <header className="flex min-h-14 items-center gap-3 border-b px-4 lg:px-6">
        <SidebarTrigger />
        <Separator orientation="vertical" className="min-h-6" />
        <SendIcon className="size-4 text-muted-foreground" />
        <h1 className="text-sm font-semibold">Quick Send</h1>
      </header>
      <QuickSendForm agentName={agentName} />
    </WorkspaceLayout>
  )
}
