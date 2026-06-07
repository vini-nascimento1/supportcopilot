import { BookOpenIcon, GripVertical } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function NotionCard() {
  return (
    <Card className="flex h-full flex-col overflow-hidden border-dashed opacity-60">
      <CardHeader className="drag-handle cursor-grab pb-3 active:cursor-grabbing">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <GripVertical className="size-3.5 text-muted-foreground/40" />
            <BookOpenIcon className="size-4 text-muted-foreground" />
            Notion
          </CardTitle>
          <Badge variant="outline" className="shrink-0 text-xs font-normal text-muted-foreground">
            Coming soon
          </Badge>
        </div>
        <CardDescription className="text-xs">Knowledge base integration coming soon.</CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 pt-0 text-center">
        <BookOpenIcon className="size-7 text-muted-foreground/30" />
        <p className="text-xs text-muted-foreground">Notion KB will appear here.</p>
      </CardContent>
    </Card>
  )
}
