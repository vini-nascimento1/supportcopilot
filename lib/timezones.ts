export const COMMON_TIMEZONES = [
  { value: "Pacific/Midway", label: "(UTC-11) Midway" },
  { value: "Pacific/Honolulu", label: "(UTC-10) Hawaii" },
  { value: "America/Anchorage", label: "(UTC-09) Alaska" },
  { value: "America/Los_Angeles", label: "(UTC-08) Pacific Time (US & Canada)" },
  { value: "America/Denver", label: "(UTC-07) Mountain Time (US & Canada)" },
  { value: "America/Chicago", label: "(UTC-06) Central Time (US & Canada)" },
  { value: "America/New_York", label: "(UTC-05) Eastern Time (US & Canada)" },
  { value: "America/Halifax", label: "(UTC-04) Atlantic Time (Canada)" },
  { value: "America/St_Johns", label: "(UTC-03:30) Newfoundland" },
  { value: "America/Sao_Paulo", label: "(UTC-03) Brasília" },
  { value: "America/Noronha", label: "(UTC-02) Fernando de Noronha" },
  { value: "Atlantic/Azores", label: "(UTC-01) Azores" },
  { value: "Europe/London", label: "(UTC+00) London / UK" },
  { value: "Europe/Paris", label: "(UTC+01) Central Europe" },
  { value: "Europe/Berlin", label: "(UTC+01) Berlin" },
  { value: "Europe/Madrid", label: "(UTC+01) Madrid" },
  { value: "Europe/Rome", label: "(UTC+01) Rome" },
  { value: "Europe/Athens", label: "(UTC+02) Athens / Eastern Europe" },
  { value: "Europe/Helsinki", label: "(UTC+02) Helsinki" },
  { value: "Europe/Moscow", label: "(UTC+03) Moscow" },
  { value: "Asia/Dubai", label: "(UTC+04) Dubai" },
  { value: "Asia/Karachi", label: "(UTC+05) Karachi" },
  { value: "Asia/Kolkata", label: "(UTC+05:30) India" },
  { value: "Asia/Dhaka", label: "(UTC+06) Dhaka" },
  { value: "Asia/Bangkok", label: "(UTC+07) Bangkok / Jakarta" },
  { value: "Asia/Shanghai", label: "(UTC+08) Beijing / Singapore" },
  { value: "Asia/Tokyo", label: "(UTC+09) Tokyo" },
  { value: "Australia/Sydney", label: "(UTC+10) Sydney" },
  { value: "Pacific/Auckland", label: "(UTC+12) Auckland" },
]

const UK_TZ = "Europe/London"

export function formatLocalAndUkTime(
  iso: string,
  localTz: string | null | undefined,
): { local: string; uk: string } {
  const date = new Date(iso)
  const opts: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }
  return {
    local: date.toLocaleString("en-GB", { ...opts, timeZone: localTz ?? UK_TZ }),
    uk: date.toLocaleString("en-GB", { ...opts, timeZone: UK_TZ }),
  }
}

export function formatLocalDate(
  date: Date,
  tz: string | null | undefined,
): string {
  return date.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: tz ?? UK_TZ,
  })
}

export function getLocalHour(tz: string | null | undefined): number {
  const now = new Date()
  return parseInt(
    now.toLocaleString("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: tz ?? UK_TZ,
    }),
    10,
  )
}

export function getUkOffset(tz: string | null | undefined): string {
  if (!tz) return ""
  const now = new Date()
  const localMin = now.getTime() + (now.getTimezoneOffset() + getTzOffsetMinutes(now, tz)) * 60000
  const ukMin = now.getTime() + (now.getTimezoneOffset() + getTzOffsetMinutes(now, UK_TZ)) * 60000
  const diff = Math.round((localMin - ukMin) / 60000)
  if (diff === 0) return ""
  const h = Math.abs(Math.floor(diff / 60))
  const m = Math.abs(diff % 60)
  const sign = diff > 0 ? "+" : "-"
  return m ? `${sign}${h}h ${m}m` : `${sign}${h}h`
}

function getTzOffsetMinutes(date: Date, tz: string): number {
  const formatted = date.toLocaleString("en-GB", {
    timeZone: tz,
    timeZoneName: "shortOffset",
  })
  const match = formatted.match(/([+-]\d{2}):?\d{2}$/)
  if (!match) return 0
  return parseInt(match[1]!, 10) * 60
}
