"use client"

import { SparklesIcon } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

interface Props {
  conversationId: string
  playbookId: string | undefined
  playbookName: string | undefined
  existingDraft: { version: number; replyBody: string } | null
}

export function DraftPanel({ playbookName }: Props) {
  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <SparklesIcon className="size-4 text-primary" />
          AI Draft Answer
        </CardTitle>
        {playbookName && (
          <CardDescription className="line-clamp-2 text-xs">
            Based on: {playbookName}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">
          ✨ AI draft generation is coming soon.
        </p>
      </CardContent>
    </Card>
  )
}
