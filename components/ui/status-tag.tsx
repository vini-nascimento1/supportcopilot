import * as React from "react"

import { cn } from "@/lib/utils"

// Quiet metadata tags, the way Geist "subtle" badges and Linear's tags work:
// a neutral 4% fill with muted text, and the ONLY color on screen is a 6px dot
// that carries the semantic state. Text is never tinted, so a row can hold a
// kind, a state and a timestamp without turning into a row of colored pills.
//
//   <Tag><MailIcon />Email</Tag>            neutral label, optional icon
//   <StatusTag tone="ok">Ready</StatusTag>  dot + label
//   <StatusDot tone="warn" />               dot alone (add sr-only text)

export type StatusTone = "neutral" | "ok" | "warn" | "critical"

const DOT_TONE: Record<StatusTone, string> = {
  neutral: "bg-muted-foreground/70",
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  critical: "bg-destructive",
}

export function StatusDot({
  tone = "neutral",
  pulse = false,
  className,
}: {
  tone?: StatusTone
  pulse?: boolean
  className?: string
}) {
  return (
    <span aria-hidden className={cn("relative inline-flex size-1.5 shrink-0", className)}>
      {pulse && (
        <span
          className={cn(
            "absolute inline-flex size-full animate-ping rounded-full opacity-60 motion-reduce:animate-none",
            DOT_TONE[tone],
          )}
        />
      )}
      <span className={cn("relative inline-flex size-full rounded-full", DOT_TONE[tone])} />
    </span>
  )
}

export function Tag({ className, children, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="tag"
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md border border-border/70 bg-foreground/[0.04] px-1.5 text-[11px] font-medium whitespace-nowrap text-muted-foreground [&>svg]:size-3 [&>svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}

export function StatusTag({
  tone = "neutral",
  pulse,
  className,
  children,
  ...props
}: React.ComponentProps<"span"> & { tone?: StatusTone; pulse?: boolean }) {
  return (
    <Tag className={className} {...props}>
      <StatusDot tone={tone} pulse={pulse} />
      {children}
    </Tag>
  )
}
