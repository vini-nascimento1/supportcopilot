import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { WorkspaceLayout } from "@/components/workspace-layout"
import { FileTextIcon } from "lucide-react"
import TemplatesContent from "./templates-content"

export const dynamic = "force-dynamic"

export default function TemplatesPage() {
  return (
    <WorkspaceLayout>
      <header className="flex min-h-14 items-center gap-3 border-b px-4 lg:px-6">
        <SidebarTrigger />
        <Separator orientation="vertical" className="min-h-6" />
        <FileTextIcon className="size-4 text-muted-foreground" />
        <h1 className="text-sm font-semibold">Templates</h1>
      </header>
      <TemplatesContent />
    </WorkspaceLayout>
  )
}
