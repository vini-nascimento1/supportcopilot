import Link from "next/link"
import { AlertCircleIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export function LoadErrorStatus() {
  return (
    <Badge variant="outline" className="shrink-0 text-xs font-normal text-muted-foreground">
      Couldn&apos;t load
    </Badge>
  )
}

export function LoadErrorBody({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-6 text-center">
      <AlertCircleIcon className="size-5 text-muted-foreground/60" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" asChild>
        <Link href="/">Retry</Link>
      </Button>
    </div>
  )
}

export function ConnectedStatus() {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 text-xs font-normal text-foreground/75"
      aria-label="Connected"
    >
      <span
        aria-hidden="true"
        className="size-1.5 rounded-full bg-foreground/55"
      />
      Connected
    </span>
  )
}

export function NotConnectedStatus() {
  return (
    <Badge variant="outline" className="shrink-0 text-xs font-normal text-muted-foreground">
      Not connected
    </Badge>
  )
}
