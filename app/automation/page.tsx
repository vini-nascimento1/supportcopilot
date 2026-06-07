import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { WorkspaceLayout } from "@/components/workspace-layout"
import { AutomationClient } from "@/components/automation-client"

export const dynamic = "force-dynamic"

export default function AutomationPage() {
  return (
    <WorkspaceLayout>
      <header className="flex min-h-14 items-center gap-3 border-b px-4 lg:px-6">
        <SidebarTrigger />
        <Separator orientation="vertical" className="min-h-6" />
        <h1 className="text-base font-medium">Automation</h1>
        <span className="text-sm text-muted-foreground">
          Triggers &amp; monitors — draft-only alerts and internal flags
        </span>
      </header>

      <main className="p-4 lg:p-6">
        <AutomationClient />
      </main>
    </WorkspaceLayout>
  )
}
