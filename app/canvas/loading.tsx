import { Loader2Icon } from "lucide-react"

// Route-level Suspense fallback — keeps the transition smooth instead of a
// blank screen while the server component fetches tools/session.
export default function CanvasLoading() {
  return (
    <div className="flex h-svh w-full items-center justify-center bg-background">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
        Opening canvas…
      </div>
    </div>
  )
}
