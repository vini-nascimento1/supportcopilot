"use client"

import { Badge } from "@/components/ui/badge"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { PlaybookChecklist } from "@/components/playbook-checklist"
import { parseSteps } from "@/lib/parse-steps"
import type { PlaybookListItem } from "@/lib/playbooks"

function Section({
  emoji,
  title,
  children,
}: {
  emoji: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <span>{emoji}</span>
        {title}
      </h3>
      {children}
    </div>
  )
}

function TextBlock({ text }: { text: string | null | undefined }) {
  if (!text) return <p className="text-sm text-muted-foreground">—</p>
  const steps = parseSteps(text)
  if (steps.length > 1) {
    return (
      <ol className="flex list-none flex-col gap-1">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-2 text-sm">
            <span className="mt-0.5 shrink-0 font-mono text-xs text-muted-foreground">
              {i + 1}.
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    )
  }
  return <p className="text-sm">{text}</p>
}

export function PlaybookRow({ playbook }: { playbook: PlaybookListItem }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <tr className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/50">
          <td className="py-3 pl-4 pr-3 align-top font-medium">
            {playbook.caseType}
          </td>
          <td className="max-w-xl truncate px-3 py-3 align-top text-muted-foreground">
            {playbook.aliases.join(", ") || "No aliases"}
          </td>
          <td className="py-3 pl-3 pr-4 align-top">
            <Badge variant="outline">{playbook.status}</Badge>
          </td>
        </tr>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="pr-8">
          <SheetTitle className="text-base leading-snug">
            {playbook.caseType}
          </SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-2">
            <Badge variant={playbook.status === "reviewed" ? "default" : "secondary"}>
              {playbook.status}
            </Badge>
            {playbook.source && (
              <span className="text-xs text-muted-foreground">
                {playbook.source}
              </span>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4 pb-6">
          {playbook.recognize && (
            <Section emoji="🔍" title="How to recognise it">
              <p className="text-sm leading-relaxed">{playbook.recognize}</p>
            </Section>
          )}

          <Section emoji="⚠️" title="Before replying — checks">
            <PlaybookChecklist checks={playbook.checks} />
          </Section>

          {playbook.resolution && (
            <Section emoji="✅" title="Resolution">
              <TextBlock text={playbook.resolution} />
            </Section>
          )}

          {playbook.dosDonts && (
            <Section emoji="🚫" title="Known mistakes / don'ts">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {playbook.dosDonts}
              </p>
            </Section>
          )}

          {playbook.aliases.length > 0 && (
            <Section emoji="🏷️" title="Aliases">
              <div className="flex flex-wrap gap-1.5">
                {playbook.aliases.map((alias) => (
                  <Badge key={alias} variant="secondary" className="font-normal">
                    {alias}
                  </Badge>
                ))}
              </div>
            </Section>
          )}

          {playbook.lastValidated && (
            <p className="text-xs text-muted-foreground">
              Last validated: {playbook.lastValidated}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
