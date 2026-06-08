import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { WorkspaceSidebar } from "@/components/workspace-sidebar"
import { getSignedInUser } from "@/lib/auth"

export async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { email, avatarUrl } = await getSignedInUser()

  return (
    <SidebarProvider>
      <WorkspaceSidebar userEmail={email} avatarUrl={avatarUrl} />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  )
}
