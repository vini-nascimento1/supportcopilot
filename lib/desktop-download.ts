import { cache } from "react"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

// GitHub's /releases/latest always redirects to the newest published release,
// so the sidebar link stays current without a deploy. The settings row
// (key: desktop_download_url) overrides it if we ever move distribution.
const DEFAULT_DOWNLOAD_URL =
  "https://github.com/vini-nascimento1/supportcopilot/releases/latest"

// Several pages (e.g. app/workspace/page.tsx) call this directly AND render
// <WorkspaceLayout>, which calls it again for the sidebar — cache() dedupes
// that to one Supabase query per request.
export const getDesktopDownloadUrl = cache(async (): Promise<string> => {
  try {
    const supabase = getSupabaseAdminClient()
    if (!supabase) return DEFAULT_DOWNLOAD_URL
    const { data } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "desktop_download_url")
      .maybeSingle()
    const url = typeof data?.value === "string" ? data.value : data?.value?.url
    return typeof url === "string" && /^https?:\/\//.test(url)
      ? url
      : DEFAULT_DOWNLOAD_URL
  } catch {
    return DEFAULT_DOWNLOAD_URL
  }
})
