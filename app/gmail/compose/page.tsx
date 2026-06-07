import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { WorkspaceLayout } from "@/components/workspace-layout"
import ComposeForm from "./compose-form"

export default function ComposePage() {
  return (
    <WorkspaceLayout>
      <header className="flex min-h-14 items-center gap-3 border-b px-4 lg:px-6">
        <SidebarTrigger />
        <Separator orientation="vertical" className="min-h-6" />
        <h1 className="text-sm font-semibold">Compose</h1>
      </header>
      <ComposeForm />
    </WorkspaceLayout>
  )
}
