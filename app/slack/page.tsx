import { WorkspaceLayout } from "@/components/workspace-layout"
import { SlackApp } from "./slack-app"

export default function SlackPage() {
  return (
    <WorkspaceLayout>
      <SlackApp />
    </WorkspaceLayout>
  )
}
