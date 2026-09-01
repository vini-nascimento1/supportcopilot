import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { WorkspaceLayout } from "@/components/workspace-layout"
import { QueueList } from "@/components/queue/queue-list"
import { getDesktopDownloadUrl } from "@/lib/desktop-download"

export const dynamic = "force-dynamic"

// The reply queue outside the Canvas: same drafts, same lock rule, usable on a
// phone or on plain web with no desktop shell. The Canvas sidebar tab
// (components/canvas/queue-panel.tsx) stays as it is for desktop work — both
// surfaces share the audited send/resolve path in
// components/queue/queue-actions.ts. See docs/vault/Canvas/Canvas Workflow.md.

export default async function QueuePage() {
  // The Intercom app id is a server env var and stays one: the client gets a
  // single deep-link prefix, not the environment.
  const intercomAppId = process.env.INTERCOM_APP_ID ?? null
  const downloadUrl = await getDesktopDownloadUrl()

  return (
    <WorkspaceLayout>
      <header className="flex min-h-14 items-center gap-3 border-b px-4 lg:px-6">
        <SidebarTrigger />
        <Separator orientation="vertical" className="min-h-6" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="text-base font-medium">Queue</h1>
        </div>
      </header>

      <main className="min-w-0 p-4 lg:p-6">
        <div className="mx-auto min-w-0 max-w-3xl">
          <QueueList intercomAppId={intercomAppId} downloadUrl={downloadUrl} />
        </div>
      </main>
    </WorkspaceLayout>
  )
}
