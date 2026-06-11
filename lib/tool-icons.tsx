import { createElement } from "react"
import {
  BanknoteIcon,
  BotIcon,
  FileTextIcon,
  GlobeIcon,
  HashIcon,
  InboxIcon,
  LandmarkIcon,
  LinkIcon,
  MailIcon,
  MessageSquareIcon,
  ShieldCheckIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react"

// Tool icons are stored in case_tools.icon as lucide icon names (kebab-case).
// Unknown/missing names fall back to a globe.
const ICONS: Record<string, LucideIcon> = {
  wrench: WrenchIcon,
  "shield-check": ShieldCheckIcon,
  banknote: BanknoteIcon,
  landmark: LandmarkIcon,
  inbox: InboxIcon,
  slack: HashIcon,
  mail: MailIcon,
  "file-text": FileTextIcon,
  "message-square": MessageSquareIcon,
  bot: BotIcon,
  link: LinkIcon,
  globe: GlobeIcon,
}

export const TOOL_ICON_NAMES = Object.keys(ICONS)

export function getToolIcon(name?: string | null): LucideIcon {
  return (name && ICONS[name]) || GlobeIcon
}

export function ToolIcon({
  name,
  className,
}: {
  name?: string | null
  className?: string
}) {
  return createElement(getToolIcon(name), { className })
}
