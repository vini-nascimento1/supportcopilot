import { WorkspaceLayout } from "@/components/workspace-layout"
import MetricsClient from "./metrics-client"

export const dynamic = "force-dynamic"

export default async function MetricsPage() {
  return (
    <WorkspaceLayout>
      <MetricsClient />
    </WorkspaceLayout>
  )
}
