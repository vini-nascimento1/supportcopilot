import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { PlaybooksClient } from "@/components/playbooks-client"
import { WorkspaceLayout } from "@/components/workspace-layout"
import { getPlaybooksDashboardData } from "@/lib/playbooks"

export const dynamic = "force-dynamic"

export default async function PlaybooksPage() {
  const playbooks = await getPlaybooksDashboardData()

  return (
    <WorkspaceLayout>
      <header className="flex min-h-14 items-center gap-3 border-b px-4 lg:px-6">
        <SidebarTrigger />
        <Separator orientation="vertical" className="min-h-6" />
        <h1 className="text-base font-medium">Playbooks</h1>
        <span className="text-sm text-muted-foreground">
          {playbooks.playbookCount} total · {playbooks.reviewedCount} reviewed
        </span>
      </header>

      <main className="p-4 lg:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Playbooks catalog</CardTitle>
            <CardDescription>
              All playbooks from Supabase. Click any row to see the full
              playbook with pre-reply checks and response templates.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PlaybooksClient playbooks={playbooks.allRows} />
          </CardContent>
        </Card>
      </main>
    </WorkspaceLayout>
  )
}
