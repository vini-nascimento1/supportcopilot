"use client"

import { ExternalLinkIcon, UserIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SlackThreadFinder } from "@/components/slack-thread-finder"

interface Props {
  conversationId: string
  playbookId: string | undefined
  playbookName: string | undefined
  customerEmail: string | null
  customerName: string
  conversationState: string
  conversationTopic: string | null
  conversationTags: string[]
  conversationUpdatedAt: string | null
  intercomUrl: string | null
}

export function CaseSidebar({
  conversationId,
  customerEmail,
  customerName,
  conversationState,
  conversationTopic,
  conversationTags,
  conversationUpdatedAt,
  intercomUrl,
}: Props) {
  return (
    <div className="flex flex-col gap-4">
      <SlackThreadFinder
        conversationId={conversationId}
        customerEmail={customerEmail}
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <UserIcon className="size-4 text-muted-foreground" />
            Case details
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Customer</span>
            <span className="font-medium">{customerName}</span>
            {customerEmail && (
              <span className="text-xs text-muted-foreground">
                {customerEmail}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">State</span>
            <Badge
              variant={conversationState === "open" ? "default" : "outline"}
              className="w-fit"
            >
              {conversationState}
            </Badge>
          </div>

          {conversationTopic && (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">Topic</span>
              <span>{conversationTopic}</span>
            </div>
          )}

          {conversationTags.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Tags</span>
              <div className="flex flex-wrap gap-1">
                {conversationTags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="font-normal">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {conversationUpdatedAt && (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">
                Last updated
              </span>
              <span className="text-xs">
                {new Date(conversationUpdatedAt).toLocaleString("en-GB", {
                  timeZone: "Europe/London",
                })}
              </span>
            </div>
          )}

          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">
              Conversation ID
            </span>
            <span className="font-mono text-xs">{conversationId}</span>
          </div>
        </CardContent>
      </Card>

      {intercomUrl && (
        <Button asChild className="w-full">
          <a href={intercomUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLinkIcon className="size-4" />
            Open in Intercom
          </a>
        </Button>
      )}
    </div>
  )
}
