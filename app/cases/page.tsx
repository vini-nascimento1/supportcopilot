import Link from "next/link"
import { ChevronRightIcon, ExternalLinkIcon, InboxIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { WorkspaceLayout } from "@/components/workspace-layout"
import { getOpenCasesQueue } from "@/lib/intercom"
import { getPlaybooksDashboardData } from "@/lib/playbooks"
import { getAgentProfile } from "@/lib/agent"

export const dynamic = "force-dynamic"

export default async function CasesPage() {
  const [playbooks, agent] = await Promise.all([
    getPlaybooksDashboardData(),
    getAgentProfile(),
  ])
  const cases = await getOpenCasesQueue(playbooks.allRows, agent.intercomAdminId)

  return (
    <WorkspaceLayout>
      <header className="flex min-h-14 items-center gap-3 border-b px-4 lg:px-6">
        <SidebarTrigger />
        <Separator orientation="vertical" className="min-h-6" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="text-base font-medium">Cases</h1>
          <Badge variant={cases.mode === "live" ? "default" : "secondary"}>
            {cases.mode === "live" ? "Live Intercom" : "Demo"}
          </Badge>
        </div>
        <Badge variant="outline" className="tabular-nums">
          {cases.rows.length} open
        </Badge>
      </header>

      <main className="p-4 lg:p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <InboxIcon className="size-4 text-muted-foreground" />
              Open Intercom cases
            </CardTitle>
            <CardDescription>
              {cases.mode === "live"
                ? "Conversations currently assigned to you. Click a row to open the case with playbook guidance and draft responses."
                : "Demo rows — add INTERCOM_ADMIN_ID to see your real queue."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {cases.error && (
              <p className="mb-4 rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground">
                {cases.error}
              </p>
            )}

            {cases.rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <InboxIcon className="size-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  No open cases assigned to you right now.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Message preview</TableHead>
                    <TableHead>Matched playbook</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cases.rows.map((row) => (
                    <TableRow
                      key={row.id}
                      className="group cursor-pointer"
                    >
                      <TableCell className="align-top font-medium">
                        <div className="flex items-center gap-1.5">
                          <Link
                            href={`/cases/${row.id}`}
                            className="hover:underline"
                          >
                            {row.customer}
                          </Link>
                          {row.intercomUrl && (
                            <a
                              href={row.intercomUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open directly in Intercom"
                            >
                              <ExternalLinkIcon className="size-3 text-muted-foreground hover:text-foreground" />
                            </a>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-sm align-top text-sm text-muted-foreground">
                        <p className="line-clamp-2">{row.snippet}</p>
                      </TableCell>
                      <TableCell className="max-w-xs align-top text-sm">
                        {row.tip ? (
                          <span>{row.tip.playbook}</span>
                        ) : (
                          <span className="text-muted-foreground">No match</span>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        {row.tip ? (
                          <Badge
                            variant={
                              row.tip.confidence === "high"
                                ? "default"
                                : row.tip.confidence === "medium"
                                  ? "secondary"
                                  : "outline"
                            }
                          >
                            {row.tip.confidence}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge variant="outline">{row.state}</Badge>
                      </TableCell>
                      <TableCell className="align-middle">
                        <Link
                          href={`/cases/${row.id}`}
                          className="flex items-center justify-center rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                          title="Open case"
                        >
                          <ChevronRightIcon className="size-4" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </WorkspaceLayout>
  )
}
