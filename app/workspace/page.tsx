import { WorkspaceLayout } from "@/components/workspace-layout"
import { CanvasWorkspace } from "@/components/canvas/canvas-workspace"
import { getCaseTools } from "@/lib/case-tools-db"
import { getDesktopDownloadUrl } from "@/lib/desktop-download"

export const dynamic = "force-dynamic"

// Keep-alive canvas workspace ("hard multitasking" mode). Every opened canvas
// stays mounted here and switching tabs only toggles visibility — no route
// change, no server refetch, AI/draft/notes preserved. Tools are shared across
// panes (global), so they're fetched once on the server; each pane fetches its
// own conversation client-side via /api/canvas/bootstrap. Entry comes from the
// mode guard on the legacy canvas routes when the Settings toggle is on.
export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>
}) {
  const [{ id }, tools, downloadUrl] = await Promise.all([
    searchParams,
    getCaseTools(),
    getDesktopDownloadUrl(),
  ])

  return (
    <WorkspaceLayout>
      <CanvasWorkspace tools={tools} downloadUrl={downloadUrl} initialActiveId={id} />
    </WorkspaceLayout>
  )
}
