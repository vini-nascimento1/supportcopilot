import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { WorkspaceSidebar } from "@/components/workspace-sidebar"
import { getSignedInEmail } from "@/lib/auth"

export async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const email = await getSignedInEmail()

  return (
    <SidebarProvider>
      <WorkspaceSidebar userEmail={email} />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  )
}
