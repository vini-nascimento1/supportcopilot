import { redirect } from "next/navigation"

import { WorkspaceLayout } from "@/components/workspace-layout"
import { getSignedInEmail } from "@/lib/auth"
import MetricsClient from "./metrics-client"

export const dynamic = "force-dynamic"

const managerEmails = (process.env.MANAGER_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)

export default async function MetricsPage() {
  const email = await getSignedInEmail()
  const isManager = !!email && managerEmails.includes(email.toLowerCase())
  if (!isManager) redirect("/")

  return (
    <WorkspaceLayout>
      <MetricsClient />
    </WorkspaceLayout>
  )
}
