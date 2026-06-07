import Link from "next/link"
import { revalidatePath } from "next/cache"
import {
  ArrowLeftIcon,
  BookOpenIcon,
  CheckCircle2Icon,
  GlobeIcon,
  InfoIcon,
  MessageSquareIcon,
  PlugIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { getSignedInEmail } from "@/lib/auth"
import { getSupabaseAdminClient } from "@/lib/supabase-admin"

export const dynamic = "force-dynamic"

async function getAgentRow(email: string) {
  const supabase = getSupabaseAdminClient()
  if (!supabase) return null
  const { data } = await supabase
    .from("agents")
    .select("id, name, email, timezone, intercom_admin_id, slack_token, notion_token")
    .eq("email", email)
    .maybeSingle()
  return data
}

async function updateProfile(formData: FormData) {
  "use server"
  const email = formData.get("email") as string
  const name = (formData.get("name") as string).trim()
  const timezone = (formData.get("timezone") as string).trim()

  const supabase = getSupabaseAdminClient()
  if (supabase && email) {
    await supabase
      .from("agents")
      .update({ name: name || null, timezone: timezone || null })
      .eq("email", email)
  }
  revalidatePath("/settings")
}

async function disconnectIntegration(formData: FormData) {
  "use server"
  const email = formData.get("email") as string
  const integration = formData.get("integration") as string

  const column =
    integration === "slack"
      ? "slack_token"
      : integration === "notion"
        ? "notion_token"
        : null

  const supabase = getSupabaseAdminClient()
  if (supabase && email && column) {
    await supabase
      .from("agents")
      .update({ [column]: null })
      .eq("email", email)
  }
  revalidatePath("/settings")
}

// Agent-facing notices for the OAuth flows — friendly copy only, never
// setup/env instructions (those live in web/README.md for admins).
const NOTICES: Record<string, { tone: "ok" | "info" | "error"; text: string }> = {
  "slack-connected": { tone: "ok", text: "Slack connected — you can now read and send messages as yourself." },
  "slack-failed": { tone: "error", text: "Slack connection didn't complete. Please try again." },
  "slack-unavailable": {
    tone: "info",
    text: "Slack integration isn't configured yet — ask your workspace admin to add SLACK_CLIENT_ID and SLACK_CLIENT_SECRET.",
  },
  "notion-connected": { tone: "ok", text: "Notion connected — knowledge base pages will now appear." },
  "notion-failed": { tone: "error", text: "Notion connection didn't complete. Please try again." },
  "notion-unavailable": {
    tone: "info",
    text: "Notion connection isn't available yet — ask your workspace admin to enable it.",
  },
}

function ConnectedBadge() {
  return (
    <Badge variant="secondary" className="gap-1">
      <CheckCircle2Icon className="size-3 text-green-500" />
      Connected
    </Badge>
  )
}

function IntegrationRow({
  icon,
  name,
  blurb,
  connected,
  action,
}: {
  icon: React.ReactNode
  name: string
  blurb: string
  connected: boolean
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between py-4 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md border bg-muted">
          {icon}
        </div>
        <div>
          <p className="text-sm font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">{blurb}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {connected ? <ConnectedBadge /> : <Badge variant="outline">Not connected</Badge>}
        {action}
      </div>
    </div>
  )
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>
}) {
  const [email, { notice: noticeKey }] = await Promise.all([
    getSignedInEmail(),
    searchParams,
  ])
  const agent = email ? await getAgentRow(email) : null
  const notice = noticeKey ? NOTICES[noticeKey] : undefined

  const slackOAuthReady = Boolean(process.env.SLACK_CLIENT_ID)
  const intercomConnected = Boolean(process.env.INTERCOM_ACCESS_TOKEN)
  const slackConnected = Boolean(agent?.slack_token ?? process.env.SLACK_BOT_TOKEN)
  const notionConnected = Boolean(agent?.notion_token ?? process.env.NOTION_API_KEY)

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur lg:px-6">
        <Link
          href="/"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Back to dashboard"
        >
          <ArrowLeftIcon className="size-4" />
        </Link>
        <h1 className="text-sm font-semibold">Settings</h1>
      </header>

      <main className="mx-auto flex max-w-2xl flex-col gap-6 p-4 lg:p-6">

        {notice && (
          <div
            className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
              notice.tone === "ok"
                ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300"
                : notice.tone === "error"
                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                  : "border-border bg-muted text-muted-foreground"
            }`}
          >
            <InfoIcon className="size-4 shrink-0" />
            {notice.text}
          </div>
        )}

        {/* Profile */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profile</CardTitle>
            <CardDescription>Your name and display preferences.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={updateProfile} className="flex flex-col gap-4">
              <input type="hidden" name="email" value={email ?? ""} />

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email-display">Email</Label>
                <Input
                  id="email-display"
                  value={email ?? "Not signed in"}
                  disabled
                  className="bg-muted/50 text-muted-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  From your Google Workspace account — read-only.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">Display name</Label>
                <Input
                  id="name"
                  name="name"
                  defaultValue={agent?.name ?? ""}
                  placeholder="Your name"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="timezone">Timezone</Label>
                <Input
                  id="timezone"
                  name="timezone"
                  defaultValue={agent?.timezone ?? "Europe/London"}
                  placeholder="e.g. Europe/London"
                />
                <p className="text-xs text-muted-foreground">
                  IANA timezone name. Used for shift greetings on the dashboard.
                </p>
              </div>

              <div className="flex justify-end">
                <Button type="submit" size="sm">Save changes</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Connected integrations */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connected integrations</CardTitle>
            <CardDescription>
              Google connects automatically when you sign in. Connect the rest
              once and they appear on your dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            {/* Google — connected automatically via the sign-in OAuth */}
            <IntegrationRow
              icon={<GlobeIcon className="size-4 text-muted-foreground" />}
              name="Google"
              blurb="Calendar · Gmail — connected automatically with your sign-in"
              connected={Boolean(email)}
              action={
                !email ? (
                  <Button size="sm" variant="outline" asChild>
                    <a href="/api/auth/login">
                      <PlugIcon className="size-3.5" />
                      Sign in
                    </a>
                  </Button>
                ) : undefined
              }
            />

            <Separator />

            {/* Intercom — connected once for the whole workspace */}
            <IntegrationRow
              icon={<MessageSquareIcon className="size-4 text-muted-foreground" />}
              name="Intercom"
              blurb={
                intercomConnected
                  ? "Case queue · conversations — managed by your workspace"
                  : "Case queue · conversations — ask your workspace admin to connect it"
              }
              connected={intercomConnected}
            />

            <Separator />

            {/* Slack — per-user OAuth: each agent connects their own account */}
            <IntegrationRow
              icon={<MessageSquareIcon className="size-4 text-muted-foreground" />}
              name="Slack"
              blurb={
                agent?.slack_token
                  ? "Your personal Slack account — send, reply, and react as yourself"
                  : slackOAuthReady
                    ? "Connect your Slack account to read and send messages as you"
                    : "Slack OAuth not configured — contact your workspace admin"
              }
              connected={slackConnected}
              action={
                agent?.slack_token ? (
                  <form action={disconnectIntegration}>
                    <input type="hidden" name="email" value={email ?? ""} />
                    <input type="hidden" name="integration" value="slack" />
                    <Button size="sm" variant="ghost" type="submit">
                      Disconnect
                    </Button>
                  </form>
                ) : slackOAuthReady ? (
                  <Button size="sm" variant="outline" asChild>
                    <a href="/api/auth/slack">
                      <PlugIcon className="size-3.5" />
                      Connect
                    </a>
                  </Button>
                ) : undefined
              }
            />

            <Separator />

            {/* Notion — per-agent OAuth */}
            <IntegrationRow
              icon={<BookOpenIcon className="size-4 text-muted-foreground" />}
              name="Notion"
              blurb="Knowledge base · playbook mining"
              connected={notionConnected}
              action={
                agent?.notion_token ? (
                  <form action={disconnectIntegration}>
                    <input type="hidden" name="email" value={email ?? ""} />
                    <input type="hidden" name="integration" value="notion" />
                    <Button size="sm" variant="ghost" type="submit">
                      Disconnect
                    </Button>
                  </form>
                ) : !notionConnected ? (
                  <Button size="sm" variant="outline" asChild>
                    <a href="/api/auth/notion">
                      <PlugIcon className="size-3.5" />
                      Connect
                    </a>
                  </Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>

        {/* Sign out */}
        <Card className="border-destructive/20">
          <CardHeader>
            <CardTitle className="text-base">Sign out</CardTitle>
            <CardDescription>Sign out of this device.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action="/api/auth/logout" method="post">
              <Button type="submit" variant="destructive" size="sm">
                Sign out
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
