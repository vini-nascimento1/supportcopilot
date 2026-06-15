import { randomUUID } from "node:crypto"
import { redirect } from "next/navigation"

import { WorkspaceLayout } from "@/components/workspace-layout"
import { CanvasTabs } from "@/components/canvas/canvas-tabs"
import { CaseCanvas } from "@/components/canvas/case-canvas"
import { CanvasModeGuard } from "@/components/canvas/canvas-mode-guard"
import { getCaseTools } from "@/lib/case-tools-db"
import { getDesktopDownloadUrl } from "@/lib/desktop-download"

export const dynamic = "force-dynamic"

// Ad-hoc canvases (no case attached) — research, comparisons, brainstorming.
// Each visit to /canvas without ?c= creates a fresh one (browser-pages style);
// existing ones live in the tab strip. Case canvases: /cases/[id]/canvas.
export default async function CanvasPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>
}) {
  const { c } = await searchParams
  if (!c) {
    redirect(`/canvas?c=${randomUUID().slice(0, 8)}`)
  }

  const [tools, downloadUrl] = await Promise.all([
    getCaseTools(),
    getDesktopDownloadUrl(),
  ])
  return (
    <WorkspaceLayout>
      <div className="flex h-svh w-full flex-col">
        <CanvasModeGuard workspaceId={`adhoc:${c}`} />
        <div className="flex h-10 shrink-0 items-center border-b px-3">
          <CanvasTabs current={{ id: `adhoc:${c}`, title: "Canvas" }} />
        </div>
        <div className="min-h-0 flex-1">
          <CaseCanvas
            storageKey={`adhoc:${c}`}
            tools={tools}
            downloadUrl={downloadUrl}
          />
        </div>
      </div>
    </WorkspaceLayout>
  )
}
