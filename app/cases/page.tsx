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
import { getOpenCasesQueue, listIntercomAdmins, type InboxFilter } from "@/lib/intercom"
import { getPlaybooksDashboardData } from "@/lib/playbooks"
import { getAgentProfile } from "@/lib/agent"
import { cn, relativeTime } from "@/lib/utils"

export const dynamic = "force-dynamic"

type CasesSearchParams = {
  inbox?: string
  sort?: string
}

function hrefForInbox(inbox: string, sort: string | undefined) {
  const params = new URLSearchParams()
  if (inbox !== "mine") params.set("inbox", inbox)
  if (sort) params.set("sort", sort)
  const query = params.toString()
  return query ? `/cases?${query}` : "/cases"
}

function hrefForSort(sort: string, inbox: string) {
  const params = new URLSearchParams()
  if (inbox !== "mine") params.set("inbox", inbox)
  params.set("sort", sort)
  return `/cases?${params.toString()}`
}

function getInboxFilter(inboxParam: string | undefined): {
  filter: InboxFilter
  key: string
} {
  if (inboxParam === "unassigned") {
    return { filter: { kind: "unassigned" }, key: "unassigned" }
  }

  if (inboxParam?.startsWith("admin:")) {
    const adminId = inboxParam.slice("admin:".length)
    if (adminId) {
      return { filter: { kind: "admin", adminId }, key: inboxParam }
    }
  }

  return { filter: { kind: "mine" }, key: "mine" }
}

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<CasesSearchParams>
}) {
  const { inbox: inboxParam, sort } = await searchParams
  const oldestFirst = sort === "oldest"
  const { filter: inbox, key: activeInbox } = getInboxFilter(inboxParam)

  const [playbooks, agent, admins] = await Promise.all([
    getPlaybooksDashboardData(),
    getAgentProfile(),
    listIntercomAdmins(),
  ])
  const cases = await getOpenCasesQueue(playbooks.allRows, agent.intercomAdminId, inbox)

  const activeAdmin =
    inbox.kind === "admin"
      ? admins.find((admin) => admin.id === inbox.adminId) ?? {
          id: inbox.adminId,
          name: `Admin ${inbox.adminId}`,
          email: null,
        }
      : null
  const inboxLabel =
    inbox.kind === "unassigned"
      ? "Unassigned"
      : inbox.kind === "admin"
        ? activeAdmin?.name ?? "Teammate"
        : "Mine"

  // Sort by last activity (newest first by default).
  const rows = [...cases.rows].sort((a, b) => {
    const ta = a.updatedAt ? Date.parse(a.updatedAt) : 0
    const tb = b.updatedAt ? Date.parse(b.updatedAt) : 0
    return oldestFirst ? ta - tb : tb - ta
  })

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
          <CardHeader className="gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <InboxIcon className="size-4 text-muted-foreground" />
                Open Intercom cases
              </CardTitle>
              <CardDescription>
                {cases.mode === "live"
                  ? `Showing ${inboxLabel.toLowerCase()} open conversations. Click a row to open the case with playbook guidance and draft responses.`
                  : "Demo rows — add INTERCOM_ADMIN_ID to see your real queue."}
              </CardDescription>
            </div>
            <nav
              className="flex gap-1 overflow-x-auto pb-1"
              aria-label="Intercom inboxes"
            >
              <Link
                href={hrefForInbox("mine", sort)}
                className={cn(
                  "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted",
                  activeInbox === "mine"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Mine
              </Link>
              <Link
                href={hrefForInbox("unassigned", sort)}
                className={cn(
                  "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted",
                  activeInbox === "unassigned"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Unassigned
              </Link>
              {admins.map((admin) => {
                const inboxKey = `admin:${admin.id}`
                return (
                  <Link
                    key={admin.id}
                    href={hrefForInbox(inboxKey, sort)}
                    className={cn(
                      "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted",
                      activeInbox === inboxKey
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    title={admin.email ?? admin.name}
                  >
                    {admin.name}
                  </Link>
                )
              })}
            </nav>
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
                  No open cases in {inboxLabel.toLowerCase()} right now.
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
                    <TableHead>
                      <span className="flex items-center gap-1">
                        Last activity
                        <span className="flex items-center gap-1 text-xs font-normal">
                          <Link
                            href={hrefForSort("newest", activeInbox)}
                            className={cn(
                              "hover:text-foreground",
                              !oldestFirst ? "text-foreground" : "text-muted-foreground",
                            )}
                            title="Newest first"
                          >
                            ↓
                          </Link>
                          <Link
                            href={hrefForSort("oldest", activeInbox)}
                            className={cn(
                              "hover:text-foreground",
                              oldestFirst ? "text-foreground" : "text-muted-foreground",
                            )}
                            title="Oldest first"
                          >
                            ↑
                          </Link>
                        </span>
                      </span>
                    </TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
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
                      <TableCell
                        className="align-top text-sm text-muted-foreground"
                        title={
                          row.updatedAt
                            ? new Date(row.updatedAt).toLocaleString("en-GB", {
                                timeZone: "Europe/London",
                              })
                            : undefined
                        }
                      >
                        {relativeTime(row.updatedAt) || "—"}
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
