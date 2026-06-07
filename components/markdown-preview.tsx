"use client"

import ReactMarkdown from "react-markdown"

export function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="markdown-preview rounded-md border bg-background p-3 text-sm leading-relaxed">
      <ReactMarkdown
        components={{
          p: ({ children }) => (
            <p className="mb-2 last:mb-0">{children}</p>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic">{children}</em>
          ),
          ul: ({ children }) => (
            <ul className="mb-2 ml-4 list-disc space-y-0.5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-2 ml-4 list-decimal space-y-0.5">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="text-sm">{children}</li>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:text-primary/80"
            >
              {children}
            </a>
          ),
          code: ({ className, children }) => {
            const isBlock = className?.includes("language-")
            return isBlock ? (
              <code className="block overflow-x-auto rounded bg-muted px-3 py-2 font-mono text-xs">
                {children}
              </code>
            ) : (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                {children}
              </code>
            )
          },
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic text-muted-foreground">
              {children}
            </blockquote>
          ),
          h1: ({ children }) => (
            <h1 className="mb-2 text-lg font-bold">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 text-base font-bold">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-1 text-sm font-bold">{children}</h3>
          ),
          hr: () => <hr className="my-3 border-muted" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
