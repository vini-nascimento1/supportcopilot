import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { WorkspaceSidebar } from "@/components/workspace-sidebar"
import { getSignedInUser } from "@/lib/auth"
import { getDesktopDownloadUrl } from "@/lib/desktop-download"
import { isGmailTemplateUser } from "@/lib/gmail-templates-auth"

const managerEmails = (process.env.MANAGER_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)

export async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const [{ email, avatarUrl }, downloadUrl] = await Promise.all([
    getSignedInUser(),
    getDesktopDownloadUrl(),
  ])
  const isManager = !!email && managerEmails.includes(email.toLowerCase())

  return (
    <SidebarProvider>
      <WorkspaceSidebar
        userEmail={email}
        avatarUrl={avatarUrl}
        isGmailTemplateUser={isGmailTemplateUser(email)}
        isManager={isManager}
        downloadUrl={downloadUrl}
      />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  )
}
