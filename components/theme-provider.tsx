"use client"

import * as React from "react"

type Theme = "light" | "dark" | "system"
type ResolvedTheme = "light" | "dark"

type ThemeContextValue = {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
}

const STORAGE_KEY = "theme"
const SYSTEM_QUERY = "(prefers-color-scheme: dark)"
const ThemeContext = React.createContext<ThemeContextValue | null>(null)

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light"
  return window.matchMedia(SYSTEM_QUERY).matches ? "dark" : "light"
}

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system"
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === "light" || stored === "dark" || stored === "system"
      ? stored
      : "system"
  } catch {
    return "system"
  }
}

function applyTheme(theme: Theme, resolvedTheme: ResolvedTheme) {
  const root = document.documentElement
  root.classList.remove("light", "dark")
  root.classList.add(resolvedTheme)
  root.style.colorScheme = resolvedTheme

  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Ignore storage failures in private/locked-down contexts.
  }
}

function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>("system")
  const [systemTheme, setSystemTheme] = React.useState<ResolvedTheme>("light")

  const resolvedTheme = theme === "system" ? systemTheme : theme

  React.useEffect(() => {
    queueMicrotask(() => {
      const nextTheme = getStoredTheme()
      setThemeState(nextTheme)
      setSystemTheme(getSystemTheme())
    })
  }, [])

  React.useEffect(() => {
    const media = window.matchMedia(SYSTEM_QUERY)
    const onChange = () => setSystemTheme(media.matches ? "dark" : "light")
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])

  React.useEffect(() => {
    applyTheme(theme, resolvedTheme)
  }, [theme, resolvedTheme])

  const setTheme = React.useCallback((nextTheme: Theme) => {
    setThemeState(nextTheme)
  }, [])

  const value = React.useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme]
  )

  return (
    <ThemeContext.Provider value={value}>
      <ThemeHotkey />
      {children}
    </ThemeContext.Provider>
  )
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

function ThemeHotkey() {
  const { resolvedTheme, setTheme } = useTheme()

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key.toLowerCase() !== "d") return
      if (isTypingTarget(event.target)) return

      setTheme(resolvedTheme === "dark" ? "light" : "dark")
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [resolvedTheme, setTheme])

  return null
}

function useTheme() {
  const value = React.useContext(ThemeContext)
  if (!value) {
    return {
      theme: "system" as Theme,
      resolvedTheme: "light" as ResolvedTheme,
      setTheme: () => {},
    }
  }
  return value
}

export { ThemeProvider, useTheme }
