"use client"

import { useState, useMemo } from "react"
import { SearchIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { PlaybookRow } from "@/components/playbook-sheet"
import type { PlaybookListItem } from "@/lib/playbooks"

interface Props {
  playbooks: PlaybookListItem[]
}

export function PlaybooksClient({ playbooks }: Props) {
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return playbooks
    return playbooks.filter((p) => {
      if (p.caseType.toLowerCase().includes(q)) return true
      if (p.aliases?.some((a) => a.toLowerCase().includes(q))) return true
      if (p.recognize?.toLowerCase().includes(q)) return true
      return false
    })
  }, [playbooks, query])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="playbook-search"
            placeholder="Try: payout delayed, OTP, document already used"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        {query && (
          <Button variant="ghost" size="icon" onClick={() => setQuery("")}>
            <XIcon className="size-4" />
            <span className="sr-only">Clear</span>
          </Button>
        )}
      </div>

      {query && (
        <p className="text-xs text-muted-foreground">
          {filtered.length === 0
            ? "No playbooks match that query."
            : `${filtered.length} of ${playbooks.length} playbooks`}
        </p>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Case type</TableHead>
            <TableHead>Aliases</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((row) => (
            <PlaybookRow key={row.id} playbook={row} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
